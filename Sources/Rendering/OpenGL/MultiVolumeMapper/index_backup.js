/* eslint
   no-console:0
   no-unused-vars:0
 */
import macro from 'vtk.js/Sources/macro';
import { vec3, mat3, mat4 } from 'gl-matrix';
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray';
import { VtkDataTypes } from 'vtk.js/Sources/Common/Core/DataArray/Constants';
import vtkHelper from 'vtk.js/Sources/Rendering/OpenGL/Helper';
import * as vtkMath from 'vtk.js/Sources/Common/Core/Math';
import vtkOpenGLFramebuffer from 'vtk.js/Sources/Rendering/OpenGL/Framebuffer';
import vtkOpenGLTexture from 'vtk.js/Sources/Rendering/OpenGL/Texture';
import vtkShaderProgram from 'vtk.js/Sources/Rendering/OpenGL/ShaderProgram';
import vtkVertexArrayObject from 'vtk.js/Sources/Rendering/OpenGL/VertexArrayObject';
import vtkViewNode from 'vtk.js/Sources/Rendering/SceneGraph/ViewNode';
import { Representation } from 'vtk.js/Sources/Rendering/Core/Property/Constants';
import {
  Wrap,
  Filter,
} from 'vtk.js/Sources/Rendering/OpenGL/Texture/Constants';
import { InterpolationType } from 'vtk.js/Sources/Rendering/Core/VolumeProperty/Constants';
import vtkVolumeVS from 'vtk.js/Sources/Rendering/OpenGL/glsl/vtkVolumeVS.glsl';

const { vtkErrorMacro } = macro;

// ----------------------------------------------------------------------------
// vtkOpenGLMultiVolumeMapper methods
// ----------------------------------------------------------------------------

function vtkOpenGLMultiVolumeMapper(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkOpenGLMultiVolumeMapper');

  publicAPI.buildPass = () => {
    model.zBufferTexture = null;
  };

  publicAPI.queryPass = (prepass, renderPass) => {
    if (prepass) {
      if (!model.renderable || !model.renderable.getVolumes().length) {
        return;
      }

      const volumeCount = model.renderable.getVolumes().length;

      renderPass.setVolumeCount(volumeCount);
    }
  };

  // ohh someone is doing a zbuffer pass, use that for
  // intermixed volume rendering
  publicAPI.opaqueZBufferPass = (prepass, renderPass) => {
    if (prepass) {
      const zbt = renderPass.getZBufferTexture();
      if (zbt !== model.zBufferTexture) {
        model.zBufferTexture = zbt;
      }
    }
  };

  // Renders myself
  publicAPI.volumePass = (prepass, renderPass) => {
    if (prepass) {
      model.openGLRenderer = publicAPI.getFirstAncestorOfType(
        'vtkOpenGLRenderer'
      );

      const ren = model.openGLRenderer.getRenderable();
      if (!ren.getUseMultiVolumeRendering()) {
        console.warn(
          'MultiVolumeMapper:volumePass useMultiVolumeMapper is not true'
        );
        return;
      }

      model.openGLRenderWindow = publicAPI.getFirstAncestorOfType(
        'vtkOpenGLRenderWindow'
      );
      model.context = model.openGLRenderWindow.getContext();
      model.tris.setOpenGLRenderWindow(model.openGLRenderWindow);
      model.jitterTexture.setOpenGLRenderWindow(model.openGLRenderWindow);
      model.framebuffer.setOpenGLRenderWindow(model.openGLRenderWindow);

      model.openGLCamera = model.openGLRenderer.getViewNodeFor(
        ren.getActiveCamera()
      );

      model.colorTexture.setOpenGLRenderWindow(model.openGLRenderWindow);
      model.opacityTexture.setOpenGLRenderWindow(model.openGLRenderWindow);

      const actors = model.renderable.getVolumes();

      publicAPI.renderPiece(ren, actors);
    }
  };

  publicAPI.buildShaders = (shaders, ren, actors) => {
    publicAPI.getShaderTemplate(shaders, ren, actors);
    publicAPI.createFragmentShader(shaders, ren, actors);
    publicAPI.replaceShaderValues(shaders, ren, actors);
  };

  publicAPI.createFragmentShader = (shaders, ren, actors) => {
    const numVolumes = actors.length;
    const maxNumComponents = 1;

    let uniformDefinitions = '';
    for (let i = 0; i < numVolumes; i++) {
      uniformDefinitions += `
        uniform vec3 vOriginVC_${i};
        uniform vec3 vSpacing_${i};
        uniform ivec3 volumeDimensions_${i}; // 3d texture dimensions
        uniform vec3 vPlaneNormal0_${i};
        uniform float vPlaneDistance0_${i};
        uniform vec3 vPlaneNormal1_${i};
        uniform float vPlaneDistance1_${i};
        uniform vec3 vPlaneNormal2_${i};
        uniform float vPlaneDistance2_${i};
        uniform vec3 vPlaneNormal3_${i};
        uniform float vPlaneDistance3_${i};
        uniform vec3 vPlaneNormal4_${i};
        uniform float vPlaneDistance4_${i};
        uniform vec3 vPlaneNormal5_${i};
        uniform float vPlaneDistance5_${i};
      `;
    }

    const fragShader = `//VTK::System::Dec
      
      // the output of this shader
      //VTK::Output::Dec
      
      varying vec3 vertexVCVSOutput;
      
      // first declare the settings from the mapper
      // that impact the code paths in here
      
      // always set vtkNumComponents 1,2,3,4
      //VTK::NumComponents
      
      // possibly define vtkUseTriliear
      //VTK::TrilinearOn
      
      // possibly define vtkIndependentComponents
      //VTK::IndependentComponentsOn
      
      // define vtkLightComplexity
      //VTK::LightComplexity
      #if vtkLightComplexity > 0
      uniform float vSpecularPower;
      uniform float vAmbient;
      uniform float vDiffuse;
      uniform float vSpecular;
      //VTK::Light::Dec
      #endif
      
      // possibly define vtkGradientOpacityOn
      //VTK::GradientOpacityOn
      #ifdef vtkGradientOpacityOn
      uniform float goscale0;
      uniform float goshift0;
      uniform float gomin0;
      uniform float gomax0;
      #if defined(vtkIndependentComponentsOn) && (vtkNumComponents > 1)
      uniform float goscale1;
      uniform float goshift1;
      uniform float gomin1;
      uniform float gomax1;
      #if vtkNumComponents >= 3
      uniform float goscale2;
      uniform float goshift2;
      uniform float gomin2;
      uniform float gomax2;
      #endif
      #if vtkNumComponents >= 4
      uniform float goscale3;
      uniform float goshift3;
      uniform float gomin3;
      uniform float gomax3;
      #endif
      #endif
      #endif
      
      // camera values
      uniform float camThick;
      uniform float camNear;
      uniform float camFar;
      uniform int cameraParallel;
      
      // values describing the volume geometry
      uniform vec3 vOriginVC;
      uniform vec3 vSpacing;
      uniform ivec3 volumeDimensions; // 3d texture dimensions
      uniform vec3 vPlaneNormal0;
      uniform float vPlaneDistance0;
      uniform vec3 vPlaneNormal1;
      uniform float vPlaneDistance1;
      uniform vec3 vPlaneNormal2;
      uniform float vPlaneDistance2;
      uniform vec3 vPlaneNormal3;
      uniform float vPlaneDistance3;
      uniform vec3 vPlaneNormal4;
      uniform float vPlaneDistance4;
      uniform vec3 vPlaneNormal5;
      uniform float vPlaneDistance5;
      
      // opacity and color textures
      uniform sampler2D otexture;
      uniform float oshift0;
      uniform float oscale0;
      uniform sampler2D ctexture;
      uniform float cshift0;
      uniform float cscale0;
      
      // jitter texture
      uniform sampler2D jtexture;
      
      // some 3D texture values
      uniform float sampleDistance;
      uniform vec3 vVCToIJK;
      
      // the heights defined below are the locations
      // for the up to four components of the tfuns
      // the tfuns have a height of 2XnumComps pixels so the
      // values are computed to hit the middle of the two rows
      // for that component
      #ifdef vtkIndependentComponentsOn
      #if vtkNumComponents == 2
      uniform float mix0;
      uniform float mix1;
      #define height0 0.25
      #define height1 0.75
      #endif
      #if vtkNumComponents == 3
      uniform float mix0;
      uniform float mix1;
      uniform float mix2;
      #define height0 0.17
      #define height1 0.5
      #define height2 0.83
      #endif
      #if vtkNumComponents == 4
      uniform float mix0;
      uniform float mix1;
      uniform float mix2;
      uniform float mix3;
      #define height0 0.125
      #define height1 0.375
      #define height2 0.625
      #define height3 0.875
      #endif
      #endif
      
      #if vtkNumComponents >= 2
      uniform float oshift1;
      uniform float oscale1;
      uniform float cshift1;
      uniform float cscale1;
      #endif
      #if vtkNumComponents >= 3
      uniform float oshift2;
      uniform float oscale2;
      uniform float cshift2;
      uniform float cscale2;
      #endif
      #if vtkNumComponents >= 4
      uniform float oshift3;
      uniform float oscale3;
      uniform float cshift3;
      uniform float cscale3;
      #endif
      
      // declaration for intermixed geometry
      //VTK::ZBuffer::Dec
      
      // Lighting values
      //VTK::Light::Dec
      
      //=======================================================================
      uniform highp sampler3D texture1;
      
      vec4 getTextureValue(vec3 pos)
      {
        vec4 tmp = texture(texture1, pos);
        #if vtkNumComponents == 1
        tmp.a = tmp.r;
        #endif
        #if vtkNumComponents == 2
        tmp.a = tmp.g;
        #endif
        #if vtkNumComponents == 3
        tmp.a = length(tmp.rgb);
        #endif
        return tmp;
      }
      
      //=======================================================================
      // compute the normal and gradient magnitude for a position
      vec4 computeNormal(vec3 pos, float scalar, vec3 tstep)
      {
        vec4 result;
      
        result.x = getTextureValue(pos + vec3(tstep.x, 0.0, 0.0)).a - scalar;
        result.y = getTextureValue(pos + vec3(0.0, tstep.y, 0.0)).a - scalar;
        result.z = getTextureValue(pos + vec3(0.0, 0.0, tstep.z)).a - scalar;
      
        // divide by spacing
        result.xyz /= vSpacing;
      
        result.w = length(result.xyz);
      
        // rotate to View Coords
        result.xyz =
        result.x * vPlaneNormal0 +
        result.y * vPlaneNormal2 +
        result.z * vPlaneNormal4;
      
        if (result.w > 0.0) {
          result.xyz /= result.w;
        }
        return result;
      }
      
        #ifdef vtkImageLabelOutlineOn
      vec3 fragCoordToIndexSpace(vec4 fragCoord) {
        vec4 ndcPos = vec4(
        (fragCoord.x / vpWidth - 0.5) * 2.0,
        (fragCoord.y / vpHeight - 0.5) * 2.0,
        (fragCoord.z - 0.5) * 2.0,
        1.0);
      
        vec4 worldCoord = DCWCMatrix * ndcPos;
        vec4 vertex = (worldCoord/worldCoord.w);
      
        return (vWCtoIDX * vertex).xyz / vec3(volumeDimensions);
      }
        #endif
      
      //=======================================================================
      // compute the normals and gradient magnitudes for a position
      // for independent components
      mat4 computeMat4Normal(vec3 pos, vec4 tValue, vec3 tstep)
      {
        mat4 result;
        vec4 distX = getTextureValue(pos + vec3(tstep.x, 0.0, 0.0)) - tValue;
        vec4 distY = getTextureValue(pos + vec3(0.0, tstep.y, 0.0)) - tValue;
        vec4 distZ = getTextureValue(pos + vec3(0.0, 0.0, tstep.z)) - tValue;
      
        // divide by spacing
        distX /= vSpacing.x;
        distY /= vSpacing.y;
        distZ /= vSpacing.z;
      
        mat3 rot;
        rot[0] = vPlaneNormal0;
        rot[1] = vPlaneNormal2;
        rot[2] = vPlaneNormal4;
      
        result[0].xyz = vec3(distX.r, distY.r, distZ.r);
        result[0].a = length(result[0].xyz);
        result[0].xyz *= rot;
        if (result[0].w > 0.0)
        {
          result[0].xyz /= result[0].w;
        }
      
        result[1].xyz = vec3(distX.g, distY.g, distZ.g);
        result[1].a = length(result[1].xyz);
        result[1].xyz *= rot;
        if (result[1].w > 0.0)
        {
          result[1].xyz /= result[1].w;
        }
      
          // optionally compute the 3rd component
          #if vtkNumComponents >= 3
        result[2].xyz = vec3(distX.b, distY.b, distZ.b);
        result[2].a = length(result[2].xyz);
        result[2].xyz *= rot;
        if (result[2].w > 0.0)
        {
          result[2].xyz /= result[2].w;
        }
          #endif
      
          // optionally compute the 4th component
          #if vtkNumComponents >= 4
        result[3].xyz = vec3(distX.a, distY.a, distZ.a);
        result[3].a = length(result[3].xyz);
        result[3].xyz *= rot;
        if (result[3].w > 0.0)
        {
          result[3].xyz /= result[3].w;
        }
          #endif
      
        return result;
      }
      
      //=======================================================================
      // Given a normal compute the gradient opacity factors
      //
      float computeGradientOpacityFactor(
      vec4 normal, float goscale, float goshift, float gomin, float gomax)
      {
        #if defined(vtkGradientOpacityOn)
        return clamp(normal.a*goscale + goshift, gomin, gomax);
        #else
        return 1.0;
        #endif
      }
      
        #if vtkLightComplexity > 0
      void applyLighting(inout vec3 tColor, vec4 normal)
      {
        vec3 diffuse = vec3(0.0, 0.0, 0.0);
        vec3 specular = vec3(0.0, 0.0, 0.0);
        //VTK::Light::Impl
        tColor.rgb = tColor.rgb*(diffuse*vDiffuse + vAmbient) + specular*vSpecular;
      }
        #endif
      
      //=======================================================================
      // Given a texture value compute the color and opacity
      //
      vec4 getColorForValue(vec4 tValue, vec3 posIS, vec3 tstep)
      {
        // compute the normal and gradient magnitude if needed
        // We compute it as a vec4 if possible otherwise a mat4
        //
        vec4 goFactor = vec4(1.0,1.0,1.0,1.0);
      
        // compute the normal vectors as needed
        #if (vtkLightComplexity > 0) || defined(vtkGradientOpacityOn)
        #if defined(vtkIndependentComponentsOn) && (vtkNumComponents > 1)
        mat4 normalMat = computeMat4Normal(posIS, tValue, tstep);
        vec4 normal0 = normalMat[0];
        vec4 normal1 = normalMat[1];
        #if vtkNumComponents > 2
        vec4 normal2 = normalMat[2];
        #endif
        #if vtkNumComponents > 3
        vec4 normal3 = normalMat[3];
        #endif
        #else
        vec4 normal0 = computeNormal(posIS, tValue.a, tstep);
        #endif
        #endif
      
        // compute gradient opacity factors as needed
        #if defined(vtkGradientOpacityOn)
        goFactor.x =
        computeGradientOpacityFactor(normal0, goscale0, goshift0, gomin0, gomax0);
        #if defined(vtkIndependentComponentsOn) && (vtkNumComponents > 1)
        goFactor.y =
        computeGradientOpacityFactor(normal1, goscale1, goshift1, gomin1, gomax1);
        #if vtkNumComponents > 2
        goFactor.z =
        computeGradientOpacityFactor(normal2, goscale2, goshift2, gomin2, gomax2);
        #if vtkNumComponents > 3
        goFactor.w =
        computeGradientOpacityFactor(normal3, goscale3, goshift3, gomin3, gomax3);
        #endif
        #endif
        #endif
        #endif
      
        // single component is always independent
        #if vtkNumComponents == 1
        vec4 tColor = texture2D(ctexture, vec2(tValue.r * cscale0 + cshift0, 0.5));
        tColor.a = goFactor.x*texture2D(otexture, vec2(tValue.r * oscale0 + oshift0, 0.5)).r;
        #endif
      
        #if defined(vtkIndependentComponentsOn) && vtkNumComponents >= 2
        vec4 tColor = mix0*texture2D(ctexture, vec2(tValue.r * cscale0 + cshift0, height0));
        tColor.a = goFactor.x*mix0*texture2D(otexture, vec2(tValue.r * oscale0 + oshift0, height0)).r;
        vec3 tColor1 = mix1*texture2D(ctexture, vec2(tValue.g * cscale1 + cshift1, height1)).rgb;
        tColor.a += goFactor.y*mix1*texture2D(otexture, vec2(tValue.g * oscale1 + oshift1, height1)).r;
        #if vtkNumComponents >= 3
        vec3 tColor2 = mix2*texture2D(ctexture, vec2(tValue.b * cscale2 + cshift2, height2)).rgb;
        tColor.a += goFactor.z*mix2*texture2D(otexture, vec2(tValue.b * oscale2 + oshift2, height2)).r;
        #if vtkNumComponents >= 4
        vec3 tColor3 = mix3*texture2D(ctexture, vec2(tValue.a * cscale3 + cshift3, height3)).rgb;
        tColor.a += goFactor.w*mix3*texture2D(otexture, vec2(tValue.a * oscale3 + oshift3, height3)).r;
        #endif
        #endif
      
        #else // then not independent
        #if vtkNumComponents == 2
        float lum = tValue.r * cscale0 + cshift0;
        float alpha = goFactor.x*texture2D(otexture, vec2(tValue.a * oscale1 + oshift1, 0.5)).r;
        vec4 tColor = vec4(lum, lum, lum, alpha);
        #endif
        #if vtkNumComponents == 3
        vec4 tColor;
        tColor.r = tValue.r * cscale0 + cshift0;
        tColor.g = tValue.g * cscale1 + cshift1;
        tColor.b = tValue.b * cscale2 + cshift2;
        tColor.a = goFactor.x*texture2D(otexture, vec2(tValue.a * oscale0 + oshift0, 0.5)).r;
        #endif
        #if vtkNumComponents == 4
        vec4 tColor;
        tColor.r = tValue.r * cscale0 + cshift0;
        tColor.g = tValue.g * cscale1 + cshift1;
        tColor.b = tValue.b * cscale2 + cshift2;
        tColor.a = goFactor.x*texture2D(otexture, vec2(tValue.a * oscale3 + oshift3, 0.5)).r;
        #endif
        #endif // dependent
      
        // apply lighting if requested as appropriate
        #if vtkLightComplexity > 0
        applyLighting(tColor.rgb, normal0);
        #if defined(vtkIndependentComponentsOn) && vtkNumComponents >= 2
        applyLighting(tColor1, normal1);
        #if vtkNumComponents >= 3
        applyLighting(tColor2, normal2);
        #if vtkNumComponents >= 4
        applyLighting(tColor3, normal3);
        #endif
        #endif
        #endif
        #endif
      
        // perform final independent blend as needed
        #if defined(vtkIndependentComponentsOn) && vtkNumComponents >= 2
        tColor.rgb += tColor1;
        #if vtkNumComponents >= 3
        tColor.rgb += tColor2;
        #if vtkNumComponents >= 4
        tColor.rgb += tColor3;
        #endif
        #endif
        #endif
      
        return tColor;
      }
      
      
      
      //=======================================================================
      // Apply the specified blend mode operation along the ray's path.
      //
      void applyBlend(vec3 posIS, vec3 endIS, float sampleDistanceIS, vec3 tdims)
      {
        vec3 tstep = 1.0/tdims;
      
        // start slightly inside and apply some jitter
        vec3 delta = endIS - posIS;
        vec3 stepIS = normalize(delta)*sampleDistanceIS;
        float raySteps = length(delta)/sampleDistanceIS;
      
        // avoid 0.0 jitter
        float jitter = 0.01 + 0.99*texture2D(jtexture, gl_FragCoord.xy/32.0).r;
        float stepsTraveled = jitter;
      
        // local vars for the loop
        vec4 color = vec4(0.0, 0.0, 0.0, 0.0);
        vec4 tValue;
        vec4 tColor;
      
        // Perform initial step at the volume boundary
        // compute the scalar
        tValue = getTextureValue(posIS);
      
        // COMPOSITE_BLEND
        // now map through opacity and color
        tColor = getColorForValue(tValue, posIS, tstep);
      
        // handle very thin volumes
        if (raySteps <= 1.0) {
          tColor.a = 1.0 - pow(1.0 - tColor.a, raySteps);
          gl_FragData[0] = tColor;
          return;
        }
      
        tColor.a = 1.0 - pow(1.0 - tColor.a, jitter);
        color = vec4(tColor.rgb*tColor.a, tColor.a);
        posIS += (jitter*stepIS);
      
        for (int i = 0; i < //VTK::MaximumSamplesValue ; ++i)
        {
          if (stepsTraveled + 1.0 >= raySteps) { break; }
      
          // compute the scalar
          tValue = getTextureValue(posIS);
      
          // now map through opacity and color
          tColor = getColorForValue(tValue, posIS, tstep);
      
          float mix = (1.0 - color.a);
      
          color = color + vec4(tColor.rgb*tColor.a, tColor.a)*mix;
          stepsTraveled++;
          posIS += stepIS;
          if (color.a > 0.99) { color.a = 1.0; break; }
        }
      
        if (color.a < 0.99 && (raySteps - stepsTraveled) > 0.0) {
          posIS = endIS;
      
          // compute the scalar
          tValue = getTextureValue(posIS);
      
          // now map through opacity and color
          tColor = getColorForValue(tValue, posIS, tstep);
          tColor.a = 1.0 - pow(1.0 - tColor.a, raySteps - stepsTraveled);
      
          float mix = (1.0 - color.a);
          color = color + vec4(tColor.rgb*tColor.a, tColor.a)*mix;
        }
      
        gl_FragData[0] = vec4(color.rgb/color.a, color.a);
      }
      
      //=======================================================================
      // Compute a new start and end point for a given ray based
      // on the provided bounded clipping plane (aka a rectangle)
      void getRayPointIntersectionBounds(
      vec3 rayPos, vec3 rayDir,
      vec3 planeDir, float planeDist,
      inout vec2 tbounds, vec3 vPlaneX, vec3 vPlaneY,
      float vSize1, float vSize2)
      {
        float result = dot(rayDir, planeDir);
        if (result == 0.0)
        {
          return;
        }
        result = -1.0 * (dot(rayPos, planeDir) + planeDist) / result;
        vec3 xposVC = rayPos + rayDir*result;
        vec3 vxpos = xposVC - vOriginVC;
        vec2 vpos = vec2(
        dot(vxpos, vPlaneX),
        dot(vxpos, vPlaneY));
      
        // on some apple nvidia systems this does not work
        // if (vpos.x < 0.0 || vpos.x > vSize1 ||
        //     vpos.y < 0.0 || vpos.y > vSize2)
        // even just
        // if (vpos.x < 0.0 || vpos.y < 0.0)
        // fails
        // so instead we compute a value that represents in and out
        //and then compute the return using this value
        float xcheck = max(0.0, vpos.x * (vpos.x - vSize1)); //  0 means in bounds
        float check = sign(max(xcheck, vpos.y * (vpos.y - vSize2))); //  0 means in bounds, 1 = out
      
        tbounds = mix(
        vec2(min(tbounds.x, result), max(tbounds.y, result)), // in value
        tbounds, // out value
        check);  // 0 in 1 out
      }
      
      //=======================================================================
      // given a
      // - ray direction (rayDir)
      // - starting point (vertexVCVSOutput)
      // - bounding planes of the volume
      // - optionally depth buffer values
      // - far clipping plane
      // compute the start/end distances of the ray we need to cast
      vec2 computeRayDistances(vec3 rayDir, vec3 tdims)
      {
        vec2 dists = vec2(100.0*camFar, -1.0);
      
        vec3 vSize = vSpacing*(tdims - 1.0);
      
        // all this is in View Coordinates
        getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
        vPlaneNormal0, vPlaneDistance0, dists, vPlaneNormal2, vPlaneNormal4,
        vSize.y, vSize.z);
        getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
        vPlaneNormal1, vPlaneDistance1, dists, vPlaneNormal2, vPlaneNormal4,
        vSize.y, vSize.z);
        getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
        vPlaneNormal2, vPlaneDistance2, dists, vPlaneNormal0, vPlaneNormal4,
        vSize.x, vSize.z);
        getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
        vPlaneNormal3, vPlaneDistance3, dists, vPlaneNormal0, vPlaneNormal4,
        vSize.x, vSize.z);
        getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
        vPlaneNormal4, vPlaneDistance4, dists, vPlaneNormal0, vPlaneNormal2,
        vSize.x, vSize.y);
        getRayPointIntersectionBounds(vertexVCVSOutput, rayDir,
        vPlaneNormal5, vPlaneDistance5, dists, vPlaneNormal0, vPlaneNormal2,
        vSize.x, vSize.y);
      
        // do not go behind front clipping plane
        dists.x = max(0.0,dists.x);
      
        // do not go PAST far clipping plane
        float farDist = -camThick/rayDir.z;
        dists.y = min(farDist,dists.y);
      
        // Do not go past the zbuffer value if set
        // This is used for intermixing opaque geometry
        //VTK::ZBuffer::Impl
      
        return dists;
      }
      
      //=======================================================================
      // Compute the index space starting position (pos) and end
      // position
      //
      void computeIndexSpaceValues(out vec3 pos, out vec3 endPos, out float sampleDistanceIS, vec3 rayDir, vec2 dists)
      {
        // compute starting and ending values in volume space
        pos = vertexVCVSOutput + dists.x*rayDir;
        pos = pos - vOriginVC;
        // convert to volume basis and origin
        pos = vec3(
        dot(pos, vPlaneNormal0),
        dot(pos, vPlaneNormal2),
        dot(pos, vPlaneNormal4));
      
        endPos = vertexVCVSOutput + dists.y*rayDir;
        endPos = endPos - vOriginVC;
        endPos = vec3(
        dot(endPos, vPlaneNormal0),
        dot(endPos, vPlaneNormal2),
        dot(endPos, vPlaneNormal4));
      
        float delta = length(endPos - pos);
      
        pos *= vVCToIJK;
        endPos *= vVCToIJK;
      
        float delta2 = length(endPos - pos);
        sampleDistanceIS = sampleDistance*delta2/delta;
      }
      
      void main() {
        vec3 rayDirVC;
      
        if (cameraParallel == 1) {
          // Camera is parallel, so the rayDir is just the direction of the camera.
          rayDirVC = vec3(0.0, 0.0, -1.0);
        } else {
          // camera is at 0,0,0 so rayDir for perspective is just the vc coord
          rayDirVC = normalize(vertexVCVSOutput);
        }
      
        vec3 tdims = vec3(volumeDimensions);
      
        // compute the start and end points for the ray
        vec2 rayStartEndDistancesVC = computeRayDistances(rayDirVC, tdims);
      
        // do we need to composite? aka does the ray have any length
        // If not, bail out early
        if (rayStartEndDistancesVC.y <= rayStartEndDistancesVC.x) {
          discard;
        }
      
        // IS = Index Space
        vec3 posIS;
        vec3 endIS;
        float sampleDistanceIS;
        computeIndexSpaceValues(posIS, endIS, sampleDistanceIS, rayDirVC, rayStartEndDistancesVC);
      
        // Perform the blending operation along the ray
        applyBlend(posIS, endIS, sampleDistanceIS, tdims);
      }
    `;

    shaders.Fragment = fragShader;
  };

  publicAPI.getShaderTemplate = (shaders, ren, actors) => {
    shaders.Vertex = vtkVolumeVS;
    shaders.Geometry = '';
  };

  publicAPI.replaceShaderValues = (shaders, ren, actors) => {
    console.warn('replaceShaderValues');
    let FSSource = shaders.Fragment;

    const numVolumes = actors.length;

    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      const actor = actors[volIdx];
      const imageData = actor.getMapper().getInputData();
      const vprop = actor.getProperty();
      const iComps = vprop.getIndependentComponents();
      const iType = vprop.getInterpolationType();
      const numComp = model.perVol[volIdx].scalarTexture.getComponents();
      model.perVol[volIdx].numComp = numComp;
      model.perVol[volIdx].iType = iType;
      model.perVol[volIdx].iComps = iComps;

      // WebGL only supports loops over constants
      // and does not support while loops so we
      // have to hard code how many steps/samples to take
      // We do a break so most systems will gracefully
      // early terminate, but it is always possible
      // a system will execute every step regardless

      const ext = imageData.getExtent();
      const spc = imageData.getSpacing();
      const vsize = vec3.create();
      vec3.set(
        vsize,
        (ext[1] - ext[0]) * spc[0],
        (ext[3] - ext[2]) * spc[1],
        (ext[5] - ext[4]) * spc[2]
      );

      const maxSamples = vec3.length(vsize) / 1;

      FSSource = vtkShaderProgram.substitute(
        FSSource,
        '//VTK::MaximumSamplesValue',
        `${Math.ceil(maxSamples)}`
      ).result;

      // set light complexity
      FSSource = vtkShaderProgram.substitute(
        FSSource,
        '//VTK::LightComplexity',
        `#define vtkLightComplexity ${model.lastLightComplexity}`
      ).result;

      // if using gradient opacity define that
      model.gopacity = actor.getProperty().getUseGradientOpacity(0);
      for (let nc = 1; iComps && !model.gopacity && nc < numComp; ++nc) {
        if (actor.getProperty().getUseGradientOpacity(nc)) {
          model.gopacity = true;
        }
      }
      if (model.gopacity) {
        FSSource = vtkShaderProgram.substitute(
          FSSource,
          '//VTK::GradientOpacityOn',
          '#define vtkGradientOpacityOn'
        ).result;
      }

      // if we have a ztexture then declare it and use it
      if (model.zBufferTexture !== null) {
        FSSource = vtkShaderProgram.substitute(
          FSSource,
          '//VTK::ZBuffer::Dec',
          [
            'uniform sampler2D zBufferTexture;',
            'uniform float vpWidth;',
            'uniform float vpHeight;',
          ]
        ).result;
        FSSource = vtkShaderProgram.substitute(
          FSSource,
          '//VTK::ZBuffer::Impl',
          [
            'vec4 depthVec = texture2D(zBufferTexture, vec2(gl_FragCoord.x / vpWidth, gl_FragCoord.y/vpHeight));',
            'float zdepth = (depthVec.r*256.0 + depthVec.g)/257.0;',
            'zdepth = zdepth * 2.0 - 1.0;',
            'zdepth = -2.0 * camFar * camNear / (zdepth*(camFar-camNear)-(camFar+camNear)) - camNear;',
            'zdepth = -zdepth/rayDir.z;',
            'dists.y = min(zdepth,dists.y);',
          ]
        ).result;
      }

      publicAPI.replaceShaderLight(shaders, ren);
    }

    const anyVolumesNeedNearestNeighbour = model.perVol.some(
      (v) => v.iType === InterpolationType.Nearest
    );
    if (anyVolumesNeedNearestNeighbour === false) {
      FSSource = vtkShaderProgram.substitute(
        FSSource,
        '//VTK::TrilinearOn',
        '#define vtkTrilinearOn'
      ).result;
    }

    const maxNumComps = 1;
    if (!maxNumComps > 1) {
      FSSource = vtkShaderProgram.substitute(
        FSSource,
        '//VTK::IndependentComponentsOn',
        '#define vtkIndependentComponentsOn'
      ).result;
    }

    // TODO[multivolume]: hardcoded for now
    FSSource = vtkShaderProgram.substitute(
      FSSource,
      '//VTK::NumComponents',
      `#define vtkNumComponents 1`
    ).result;

    FSSource = vtkShaderProgram.substitute(
      FSSource,
      '/* VTK::NumVolumes */',
      `${numVolumes}`
    ).result;

    shaders.Fragment = FSSource;

    console.warn(FSSource);
  };

  publicAPI.replaceShaderLight = (shaders, ren) => {
    let FSSource = shaders.Fragment;

    // check for shadow maps
    const shadowFactor = '';

    switch (model.lastLightComplexity) {
      default:
      case 0: // no lighting, tcolor is fine as is
        break;

      case 1: // headlight
      case 2: // light kit
      case 3: {
        // positional not implemented fallback to directional
        let lightNum = 0;
        ren.getLights().forEach((light) => {
          const status = light.getSwitch();
          if (status > 0) {
            FSSource = vtkShaderProgram.substitute(
              FSSource,
              '//VTK::Light::Dec',
              [
                // intensity weighted color
                `uniform vec3 lightColor${lightNum};`,
                `uniform vec3 lightDirectionVC${lightNum}; // normalized`,
                `uniform vec3 lightHalfAngleVC${lightNum}; // normalized`,
                '//VTK::Light::Dec',
              ],
              false
            ).result;
            FSSource = vtkShaderProgram.substitute(
              FSSource,
              '//VTK::Light::Impl',
              [
                //              `  float df = max(0.0, dot(normal.rgb, -lightDirectionVC${lightNum}));`,
                `  float df = abs(dot(normal.rgb, -lightDirectionVC${lightNum}));`,
                `  diffuse += ((df${shadowFactor}) * lightColor${lightNum});`,
                // '  if (df > 0.0)',
                // '    {',
                //              `    float sf = pow( max(0.0, dot(lightHalfAngleWC${lightNum},normal.rgb)), specularPower);`,
                `    float sf = pow( abs(dot(lightHalfAngleVC${lightNum},normal.rgb)), vSpecularPower);`,
                `    specular += ((sf${shadowFactor}) * lightColor${lightNum});`,
                //              '    }',
                '  //VTK::Light::Impl',
              ],
              false
            ).result;
            lightNum++;
          }
        });
      }
    }

    shaders.Fragment = FSSource;
  };

  publicAPI.getNeedToRebuildShaders = (cellBO, ren, actors) => {
    // TODO[multivolume] Come back to this...

    const actor = actors[0];
    // do we need lighting?
    let lightComplexity = 0;
    if (actor.getProperty().getShade()) {
      // consider the lighting complexity to determine which case applies
      // simple headlight, Light Kit, the whole feature set of VTK
      lightComplexity = 0;
      model.numberOfLights = 0;

      ren.getLights().forEach((light) => {
        const status = light.getSwitch();
        if (status > 0) {
          model.numberOfLights++;
          if (lightComplexity === 0) {
            lightComplexity = 1;
          }
        }

        if (
          lightComplexity === 1 &&
          (model.numberOfLights > 1 ||
            light.getIntensity() !== 1.0 ||
            !light.lightTypeIsHeadLight())
        ) {
          lightComplexity = 2;
        }
        if (lightComplexity < 3 && light.getPositional()) {
          lightComplexity = 3;
        }
      });
    }

    let needRebuild = false;
    if (model.lastLightComplexity !== lightComplexity) {
      model.lastLightComplexity = lightComplexity;
      needRebuild = true;
    }

    // has something changed that would require us to recreate the shader?
    if (
      cellBO.getProgram() === 0 ||
      needRebuild ||
      model.lastHaveSeenDepthRequest !== model.haveSeenDepthRequest ||
      !!model.lastZBufferTexture !== !!model.zBufferTexture ||
      cellBO.getShaderSourceTime().getMTime() < publicAPI.getMTime() ||
      cellBO.getShaderSourceTime().getMTime() < actor.getMTime() ||
      cellBO.getShaderSourceTime().getMTime() < model.renderable.getMTime()
    ) {
      //  // ||
      //       //cellBO.getShaderSourceTime().getMTime() < actor.getMTime()
      model.lastZBufferTexture = model.zBufferTexture;
      return true;
    }

    return false;
  };

  publicAPI.updateShaders = (cellBO, ren, actors) => {
    console.warn('updateShaders');
    model.lastBoundBO = cellBO;

    // has something changed that would require us to recreate the shader?
    if (publicAPI.getNeedToRebuildShaders(cellBO, ren, actors)) {
      const shaders = { Vertex: null, Fragment: null, Geometry: null };

      publicAPI.buildShaders(shaders, ren, actors);

      // compile and bind the program if needed
      const newShader = model.openGLRenderWindow
        .getShaderCache()
        .readyShaderProgramArray(
          shaders.Vertex,
          shaders.Fragment,
          shaders.Geometry
        );

      // if the shader changed reinitialize the VAO
      if (newShader !== cellBO.getProgram()) {
        cellBO.setProgram(newShader);
        // reset the VAO as the shader has changed
        cellBO.getVAO().releaseGraphicsResources();
      }

      cellBO.getShaderSourceTime().modified();
    } else {
      model.openGLRenderWindow
        .getShaderCache()
        .readyShaderProgram(cellBO.getProgram());
    }

    cellBO.getVAO().bind();

    actors.forEach((actor, volIdx) => {
      model.perVol[volIdx] = Object.assign({}, model.perVol[volIdx], {
        modelToView: mat4.create() || model.perVol[volIdx].modelToView,
        idxToView: mat4.create() || model.perVol[volIdx].idxToView,
        idxNormalMatrix: mat3.create() || model.perVol[volIdx].idxNormalMatrix,
      });
    });

    publicAPI.setMapperShaderParameters(cellBO, ren, actors);
    publicAPI.setCameraShaderParameters(cellBO, ren, actors);
    publicAPI.setPropertyShaderParameters(cellBO, ren, actors);
  };

  publicAPI.setMapperShaderParameters = (cellBO, ren) => {
    console.warn('setMapperShaderParameters');
    // Now to update the VAO too, if necessary.
    const program = cellBO.getProgram();

    if (
      cellBO.getCABO().getElementCount() &&
      (model.VBOBuildTime.getMTime() >
        cellBO.getAttributeUpdateTime().getMTime() ||
        cellBO.getShaderSourceTime().getMTime() >
          cellBO.getAttributeUpdateTime().getMTime())
    ) {
      if (program.isAttributeUsed('vertexDC')) {
        if (
          !cellBO
            .getVAO()
            .addAttributeArray(
              program,
              cellBO.getCABO(),
              'vertexDC',
              cellBO.getCABO().getVertexOffset(),
              cellBO.getCABO().getStride(),
              model.context.FLOAT,
              3,
              model.context.FALSE
            )
        ) {
          vtkErrorMacro('Error setting vertexDC in shader VAO.');
        }
      }
      cellBO.getAttributeUpdateTime().modified();
    }

    const textureLocations = model.perVol.map(({ scalarTexture }) =>
      scalarTexture.getTextureUnit()
    );

    program.setUniformi(`texture`, textureLocations[0]);

    program.setUniformf('sampleDistance', 1);

    // if we have a zbuffer texture then set it
    if (model.zBufferTexture !== null) {
      program.setUniformi(
        'zBufferTexture',
        model.zBufferTexture.getTextureUnit()
      );
      const size = publicAPI.getRenderTargetSize();
      program.setUniformf('vpWidth', size[0]);
      program.setUniformf('vpHeight', size[1]);
    }
  };

  publicAPI.getKeyMatrices = (actors) => {
    // has the actor changed?
    actors.forEach((actor, volIdx) => {
      if (model.renderable.getMTime() < model.keyMatrixTime.getMTime()) {
        return;
      }

      const actMatrices = model.perVol[volIdx].actMats || {
        normalMatrix: mat3.create(),
        MCWCMatrix: mat4.create(),
      };

      actor.computeMatrix();
      mat4.copy(actMatrices.MCWCMatrix, actor.getMatrix());
      mat4.transpose(actMatrices.MCWCMatrix, actMatrices.MCWCMatrix);

      if (actor.getIsIdentity()) {
        mat3.identity(actMatrices.normalMatrix);
      } else {
        mat3.fromMat4(actMatrices.normalMatrix, actMatrices.MCWCMatrix);
        mat3.invert(actMatrices.normalMatrix, actMatrices.normalMatrix);
      }

      model.perVol[volIdx].actMats = {
        mcwc: actMatrices.MCWCMatrix,
        normalMatrix: actMatrices.normalMatrix,
      };
    });

    model.keyMatrixTime.modified();
  };

  publicAPI.setCameraShaderParameters = (cellBO, ren, actors) => {
    console.warn('setCameraShaderParameters');
    // // [WMVD]C == {world, model, view, display} coordinates
    // // E.g., WCDC == world to display coordinate transformation
    const keyMats = model.openGLCamera.getKeyMatrices(ren);
    publicAPI.getKeyMatrices(actors);

    actors.forEach((actor, volIdx) => {
      mat4.multiply(
        model.perVol[volIdx].modelToView,
        keyMats.wcvc,
        model.perVol[volIdx].actMats.mcwc
      );
    });

    const program = cellBO.getProgram();

    const cam = model.openGLCamera.getRenderable();
    const crange = cam.getClippingRange();
    program.setUniformf('camThick', crange[1] - crange[0]);
    program.setUniformf('camNear', crange[0]);
    program.setUniformf('camFar', crange[1]);

    // const bounds = model.currentInput.getBounds();
    // const dims = model.currentInput.getDimensions();

    // compute the viewport bounds of the volume
    // we will only render those fragments.
    const pos = vec3.create();
    // const dir = vec3.create();

    // TODO[multivolume]: Update input to vertex shader to compute dcxmin
    // dcxmax, dcymin,dcymax from the combination of volumes
    const dcxmin = -0.3429373800754547;
    const dcxmax = 0.3429373800754547;
    const dcymin = -0.5773502588272095;
    const dcymax = 0.5773502588272095;

    /*
    let dcxmin = 1.0;
    let dcxmax = -1.0;
    let dcymin = 1.0;
    let dcymax = -1.0;

    for (let i = 0; i < 8; ++i) {
      vec3.set(
        pos,
        bounds[i % 2],
        bounds[2 + (Math.floor(i / 2) % 2)],
        bounds[4 + Math.floor(i / 4)]
      );
      vec3.transformMat4(pos, pos, model.modelToView);
      if (!cam.getParallelProjection()) {
        vec3.normalize(dir, pos);

        // now find the projection of this point onto a
        // nearZ distance plane. Since the camera is at 0,0,0
        // in VC the ray is just t*pos and
        // t is -nearZ/dir.z
        // intersection becomes pos.x/pos.z
        const t = -crange[0] / pos[2];
        vec3.scale(pos, dir, t);
      }
      // now convert to DC
      vec3.transformMat4(pos, pos, keyMats.vcdc);

      dcxmin = Math.min(pos[0], dcxmin);
      dcxmax = Math.max(pos[0], dcxmax);
      dcymin = Math.min(pos[1], dcymin);
      dcymax = Math.max(pos[1], dcymax);
    } */

    program.setUniformf('dcxmin', dcxmin);
    program.setUniformf('dcxmax', dcxmax);
    program.setUniformf('dcymin', dcymin);
    program.setUniformf('dcymax', dcymax);

    if (program.isUniformUsed('cameraParallel')) {
      program.setUniformi('cameraParallel', cam.getParallelProjection());
    }

    // map normals through normal matrix
    // then use a point on the plane to compute the distance
    const numVolumes = actors.length;

    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      const actor = actors[volIdx];
      const imageData = actor.getMapper().getInputData();
      const ext = imageData.getExtent();
      const spc = imageData.getSpacing();
      const dims = imageData.getDimensions();

      model.perVol[volIdx].vPlaneNormal = [];
      model.perVol[volIdx].vPlaneDistance = [];

      for (let i = 0; i < 6; ++i) {
        const normal = vec3.create();
        const pos2 = vec3.create();

        switch (i) {
          default:
          case 0:
            vec3.set(normal, 1.0, 0.0, 0.0);
            vec3.set(pos2, ext[1], ext[3], ext[5]);
            break;
          case 1:
            vec3.set(normal, -1.0, 0.0, 0.0);
            vec3.set(pos2, ext[0], ext[2], ext[4]);
            break;
          case 2:
            vec3.set(normal, 0.0, 1.0, 0.0);
            vec3.set(pos2, ext[1], ext[3], ext[5]);
            break;
          case 3:
            vec3.set(normal, 0.0, -1.0, 0.0);
            vec3.set(pos2, ext[0], ext[2], ext[4]);
            break;
          case 4:
            vec3.set(normal, 0.0, 0.0, 1.0);
            vec3.set(pos2, ext[1], ext[3], ext[5]);
            break;
          case 5:
            vec3.set(normal, 0.0, 0.0, -1.0);
            vec3.set(pos2, ext[0], ext[2], ext[4]);
            break;
        }

        vec3.transformMat3(
          normal,
          normal,
          model.perVol[volIdx].idxNormalMatrix
        );
        vec3.transformMat4(pos2, pos2, model.perVol[volIdx].idxToView);

        const dist = -1.0 * vec3.dot(pos2, normal);

        model.perVol[volIdx].vPlaneNormal[i] = [
          normal[0],
          normal[1],
          normal[2],
        ];
        model.perVol[volIdx].vPlaneDistance[i] = dist;
      }

      const vsize = vec3.create();
      vec3.set(
        vsize,
        (ext[1] - ext[0] + 1) * spc[0],
        (ext[3] - ext[2] + 1) * spc[1],
        (ext[5] - ext[4] + 1) * spc[2]
      );

      model.perVol[volIdx].vSpacing = spc;

      vec3.set(pos, ext[0], ext[2], ext[4]);
      imageData.indexToWorldVec3(pos, pos);

      vec3.transformMat4(pos, pos, model.perVol[volIdx].modelToView);
      model.perVol[volIdx].vOriginVC = pos;

      // apply the volume directions
      const i2wmat4 = imageData.getIndexToWorld();
      mat4.multiply(
        model.perVol[volIdx].idxToView,
        model.perVol[volIdx].modelToView,
        i2wmat4
      );

      /* mat3.multiply(
        model.idxNormalMatrix,
        keyMats.normalMatrix,
        actMats.normalMatrix
      ); */
      mat3.multiply(
        model.perVol[volIdx].idxNormalMatrix,
        model.perVol[volIdx].idxNormalMatrix,
        imageData.getDirection()
      );

      // const maxSamples = vec3.length(vsize) / 1;
      // if (maxSamples > model.renderable.getMaximumSamplesPerRay()) {
      /* if (maxSamples > model.renderable.getMaximumSamplesPerRay()) {
        vtkWarningMacro(`The number of steps required ${Math.ceil(
          maxSamples
        )} is larger than the
        specified maximum number of steps ${model.renderable.getMaximumSamplesPerRay()}.
        Please either change the
        volumeMapper sampleDistance or its maximum number of samples.`);
      } */

      const vctoijk = vec3.create();

      vec3.set(vctoijk, 1.0, 1.0, 1.0);
      vec3.divide(vctoijk, vctoijk, vsize);

      model.perVol[volIdx].vVCToIJK = vctoijk;
      model.perVol[volIdx].volumeDimensions = dims;
    }

    /* for (let i = 0; i < 6; ++i) {
      // we have the plane in view coordinates
      // specify the planes in view coordinates
      program.setUniform3f(`vPlaneNormal${i}Arr`, ...vPlaneNormal[i]);
      program.setUniformf(`vPlaneDistance${i}Arr`, vPlaneDistance[i]);
    } */

    // TODO[multivolume]: Temporarily hardcoded for now
    program.setUniform3f('vPlaneNormal0', ...[1, 0, 0]);
    program.setUniform3f('vPlaneNormal1', ...[-1, 0, 0]);
    program.setUniform3f('vPlaneNormal2', ...[0, 1, 0]);
    program.setUniform3f('vPlaneNormal3', ...[0, -1, 0]);
    program.setUniform3f('vPlaneNormal4', ...[0, 0, 1]);
    program.setUniform3f('vPlaneNormal5', ...[0, 0, -1]);

    program.setUniformf('vPlaneDistance0', -4.5);
    program.setUniformf('vPlaneDistance1', -4.5);
    program.setUniformf('vPlaneDistance2', -4.5);
    program.setUniformf('vPlaneDistance3', -4.5);
    program.setUniformf('vPlaneDistance4', 25.614585876464844);
    program.setUniformf('vPlaneDistance5', -34.614585876464844);

    program.setUniform3f('vSpacing', ...model.perVol[0].vSpacing);
    program.setUniform3f('vOriginVC', ...model.perVol[0].vOriginVC);
    program.setUniform3f('vVCToIJK', ...model.perVol[0].vVCToIJK);
    program.setUniform3i(
      'volumeDimensions',
      ...model.perVol[0].volumeDimensions
    );

    // handle lighting values
    switch (model.lastLightComplexity) {
      default:
      case 0: // no lighting, tcolor is fine as is
        break;

      case 1: // headlight
      case 2: // light kit
      case 3: {
        const normal = vec3.create();

        // positional not implemented fallback to directional
        // mat3.transpose(keyMats.normalMatrix, keyMats.normalMatrix);
        let lightNum = 0;
        const lightColor = [];
        ren.getLights().forEach((light) => {
          const status = light.getSwitch();
          if (status > 0) {
            const dColor = light.getColor();
            const intensity = light.getIntensity();
            lightColor[0] = dColor[0] * intensity;
            lightColor[1] = dColor[1] * intensity;
            lightColor[2] = dColor[2] * intensity;
            program.setUniform3fArray(`lightColor${lightNum}`, lightColor);
            const ldir = light.getDirection();
            vec3.set(normal, ldir[0], ldir[1], ldir[2]);
            vec3.transformMat3(normal, normal, keyMats.normalMatrix);
            program.setUniform3f(
              `lightDirectionVC${lightNum}`,
              normal[0],
              normal[1],
              normal[2]
            );
            // camera DOP is 0,0,-1.0 in VC
            const halfAngle = [
              -0.5 * normal[0],
              -0.5 * normal[1],
              -0.5 * (normal[2] - 1.0),
            ];
            program.setUniform3fArray(`lightHalfAngleVC${lightNum}`, halfAngle);
            lightNum++;
          }
        });
        // mat3.transpose(keyMats.normalMatrix, keyMats.normalMatrix);
      }
    }
  };

  publicAPI.setPropertyShaderParameters = (cellBO, ren, actors) => {
    console.warn('setPropertyShaderParameters');
    const program = cellBO.getProgram();

    program.setUniformi('ctexture', model.colorTexture.getTextureUnit());
    program.setUniformi('otexture', model.opacityTexture.getTextureUnit());
    program.setUniformi('jtexture', model.jitterTexture.getTextureUnit());

    const perVol = model.perVol;
    const numVolumes = actors.length;

    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      // Create an object to store the per-component values for later
      // We call setUniform later on with this information
      const actor = actors[volIdx];
      const vprop = actor.getProperty();
      const volInfo = perVol[volIdx].scalarTexture.getVolumeInfo();

      // set the component mix when independent
      const iComps = vprop.getIndependentComponents();
      const iType = vprop.getInterpolationType();
      const numComp = actor
        .getMapper()
        .getInputData()
        .getPointData()
        .getNumberOfComponents();

      const volumeData = {
        oscale: [],
        oshift: [],
        cscale: [],
        cshift: [],
        ambient: null,
        diffuse: null,
        specular: null,
        specularPower: null,
        numComp,
        iComps,
        iType,
      };

      /*
      TODO[multivolume]: Come back to independent component mixing

      if (iComps && numComp >= 2) {
        let totalComp = 0.0;
        for (let i = 0; i < numComp; ++i) {
          totalComp += actor.getProperty().getComponentWeight(i);
        }
        for (let i = 0; i < numComp; ++i) {
          program.setUniformf(
            `mix${i}`,
            actor.getProperty().getComponentWeight(i) / totalComp
          );
        }
      }
      */

      // three levels of shift scale combined into one
      // for performance in the fragment shader
      for (let i = 0; i < numComp; ++i) {
        const target = iComps ? i : 0;
        const sscale = volInfo.scale[i];
        const ofun = vprop.getScalarOpacity(target);
        const oRange = ofun.getRange();
        volumeData.oscale[i] = sscale / (oRange[1] - oRange[0]);
        volumeData.oshift[i] =
          (volInfo.offset[i] - oRange[0]) / (oRange[1] - oRange[0]);

        const cfun = vprop.getRGBTransferFunction(target);
        const cRange = cfun.getRange();
        volumeData.cshift[i] =
          (volInfo.offset[i] - cRange[0]) / (cRange[1] - cRange[0]);
        volumeData.cscale[i] = sscale / (cRange[1] - cRange[0]);
      }

      // TODO[multivolume]: Temporarily disable gradient opacity
      model.gopacity = false;
      if (model.gopacity) {
        if (iComps) {
          for (let nc = 0; nc < numComp; ++nc) {
            const sscale = volInfo.scale[nc];
            const useGO = vprop.getUseGradientOpacity(nc);
            if (useGO) {
              const gomin = vprop.getGradientOpacityMinimumOpacity(nc);
              const gomax = vprop.getGradientOpacityMaximumOpacity(nc);
              program.setUniformf(`gomin${nc}`, gomin);
              program.setUniformf(`gomax${nc}`, gomax);
              const goRange = [
                vprop.getGradientOpacityMinimumValue(nc),
                vprop.getGradientOpacityMaximumValue(nc),
              ];
              program.setUniformf(
                `goscale${nc}`,
                (sscale * (gomax - gomin)) / (goRange[1] - goRange[0])
              );
              program.setUniformf(
                `goshift${nc}`,
                (-goRange[0] * (gomax - gomin)) / (goRange[1] - goRange[0]) +
                  gomin
              );
            } else {
              program.setUniformf(`gomin${nc}`, 1.0);
              program.setUniformf(`gomax${nc}`, 1.0);
              program.setUniformf(`goscale${nc}`, 0.0);
              program.setUniformf(`goshift${nc}`, 1.0);
            }
          }
        } else {
          const sscale = volInfo.scale[numComp - 1];
          const gomin = vprop.getGradientOpacityMinimumOpacity(0);
          const gomax = vprop.getGradientOpacityMaximumOpacity(0);
          program.setUniformf('gomin0', gomin);
          program.setUniformf('gomax0', gomax);
          const goRange = [
            vprop.getGradientOpacityMinimumValue(0),
            vprop.getGradientOpacityMaximumValue(0),
          ];
          program.setUniformf(
            'goscale0',
            (sscale * (gomax - gomin)) / (goRange[1] - goRange[0])
          );
          program.setUniformf(
            'goshift0',
            (-goRange[0] * (gomax - gomin)) / (goRange[1] - goRange[0]) + gomin
          );
        }
      }

      if (model.lastLightComplexity > 0) {
        volumeData.ambient = vprop.getAmbient();
        volumeData.diffuse = vprop.getDiffuse();
        volumeData.specular = vprop.getSpecular();
        volumeData.specularPower = vprop.getSpecularPower();
      }

      perVol[volIdx] = Object.assign({}, perVol[volIdx], volumeData);
    }

    // Set Uniform arrays from compiled data per volume
    const numComps = perVol.map((v) => v.numComp);
    const maxNumComp = Math.max(...numComps);
    const keys = ['oscale', 'oshift', 'cshift', 'cscale'];

    /* Aim here is to produce the following:

    Example:
    - Vol 1 has 1 comp
    -  Vol 2 has 4 comp

    oscale0 = [vol1comp1, vol2comp1, vol2comp1]
    oscale1 = [0.0, vol2comp2]
    oscale2 = [0.0, vol2comp3]
    oscale3 = [0.0, vol2comp4]
     */

    for (let i = 0; i < maxNumComp; ++i) {
      keys.forEach((key) => {
        const value = perVol.map((v) => v[key][i]);

        program.setUniformf(`${key}${i}`, value);
      });
    }

    program.setUniformf('vAmbient', perVol[0].ambient);
    program.setUniformf('vDiffuse', perVol[0].diffuse);
    program.setUniformf('vSpecular', perVol[0].specular);
    program.setUniformf('vSpecularPower', perVol[0].specularPower);
  };

  publicAPI.getRenderTargetSize = () => {
    if (model.lastXYF > 1.43) {
      const sz = model.framebuffer.getSize();
      return [model.fvp[0] * sz[0], model.fvp[1] * sz[1]];
    }
    return model.openGLRenderWindow.getFramebufferSize();
  };

  // Just for debugging
  publicAPI.getProgramInfo = (gl, program) => {
    const result = {
      attributes: [],
      uniforms: [],
      attributeCount: 0,
      uniformCount: 0,
    };

    const activeUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);

    const activeAttributes = gl.getProgramParameter(
      program,
      gl.ACTIVE_ATTRIBUTES
    );

    // Taken from the WebGl spec:
    // http://www.khronos.org/registry/webgl/specs/latest/1.0/#5.14
    const enums = {
      0x8b50: 'FLOAT_VEC2',
      0x8b51: 'FLOAT_VEC3',
      0x8b52: 'FLOAT_VEC4',
      0x8b53: 'INT_VEC2',
      0x8b54: 'INT_VEC3',
      0x8b55: 'INT_VEC4',
      0x8b56: 'BOOL',
      0x8b57: 'BOOL_VEC2',
      0x8b58: 'BOOL_VEC3',
      0x8b59: 'BOOL_VEC4',
      0x8b5a: 'FLOAT_MAT2',
      0x8b5b: 'FLOAT_MAT3',
      0x8b5c: 'FLOAT_MAT4',
      0x8b5e: 'SAMPLER_2D',
      0x8b60: 'SAMPLER_CUBE',
      0x1400: 'BYTE',
      0x1401: 'UNSIGNED_BYTE',
      0x1402: 'SHORT',
      0x1403: 'UNSIGNED_SHORT',
      0x1404: 'INT',
      0x1405: 'UNSIGNED_INT',
      0x1406: 'FLOAT',
    };

    // Loop through active uniforms
    for (let i = 0; i < activeUniforms; i++) {
      const uniform = gl.getActiveUniform(program, i);
      const location = gl.getUniformLocation(program, uniform.name);
      const value = gl.getUniform(program, location);
      uniform.typeName = enums[uniform.type];
      result.uniforms.push({
        name: uniform.name,
        typeName: uniform.typeName,
        value,
        location,
        size: uniform.size,
      });

      result.uniformCount += uniform.size;
    }

    // Loop through active attributes
    for (let i = 0; i < activeAttributes; i++) {
      const attribute = gl.getActiveAttrib(program, i);
      attribute.typeName = enums[attribute.type];
      result.attributes.push(attribute);
      result.attributeCount += attribute.size;
    }

    result.uniforms.sort((a, b) => {
      const nameA = a.name.toUpperCase();
      const nameB = b.name.toUpperCase();
      if (nameA > nameB) {
        return -1;
      }

      if (nameB > nameA) {
        return 1;
      }

      return 0;
    });

    return result;
  };

  publicAPI.renderPieceStart = (ren, actors) => {
    console.warn('renderPieceStart');
    // TODO[multivolume] - This section of the code
    // seems to compute sample distances
    // We need to update this for multiple volumes.

    const rwi = ren.getVTKWindow().getInteractor();
    const rft = rwi.getLastFrameTime();
    // console.log(`last frame time ${Math.floor(1.0 / rft)}`);

    // frame time is typically for a couple frames prior
    // which makes it messy, so keep long running averages
    // of frame times and pixels rendered
    model.avgFrameTime = 0.97 * model.avgFrameTime + 0.03 * rft;
    model.avgWindowArea =
      0.97 * model.avgWindowArea + 0.03 / (model.lastXYF * model.lastXYF);

    if (
      ren
        .getVTKWindow()
        .getInteractor()
        .isAnimating()
    ) {
      // compute target xy factor
      let txyf = Math.sqrt(
        (model.avgFrameTime * rwi.getDesiredUpdateRate()) / model.avgWindowArea
      );

      // limit subsampling to a factor of 10
      if (txyf > 10.0) {
        txyf = 10.0;
      }

      model.targetXYF = txyf;
    } else {
      model.targetXYF = Math.sqrt(
        (model.avgFrameTime * rwi.getStillUpdateRate()) / model.avgWindowArea
      );
    }

    // have some inertia to change states around 1.43
    if (model.targetXYF < 1.53 && model.targetXYF > 1.33) {
      model.targetXYF = model.lastXYF;
    }

    // and add some inertia to change at all
    if (Math.abs(1.0 - model.targetXYF / model.lastXYF) < 0.1) {
      model.targetXYF = model.lastXYF;
    }
    model.lastXYF = model.targetXYF;

    // only use FBO beyond this value
    if (model.lastXYF <= 1.43) {
      model.lastXYF = 1.0;
    }

    // console.log(`last target  ${model.lastXYF} ${model.targetXYF}`);
    // console.log(`awin aft  ${model.avgWindowArea} ${model.avgFrameTime}`);
    const xyf = model.lastXYF;

    const size = model.openGLRenderWindow.getFramebufferSize();

    // create/resize framebuffer if needed
    if (xyf > 1.43) {
      model.framebuffer.saveCurrentBindingsAndBuffers();

      if (model.framebuffer.getGLFramebuffer() === null) {
        model.framebuffer.create(
          Math.floor(size[0] * 0.7),
          Math.floor(size[1] * 0.7)
        );
        model.framebuffer.populateFramebuffer();
      } else {
        const fbSize = model.framebuffer.getSize();
        if (
          fbSize[0] !== Math.floor(size[0] * 0.7) ||
          fbSize[1] !== Math.floor(size[1] * 0.7)
        ) {
          model.framebuffer.create(
            Math.floor(size[0] * 0.7),
            Math.floor(size[1] * 0.7)
          );
          model.framebuffer.populateFramebuffer();
        }
      }
      model.framebuffer.bind();
      const gl = model.context;
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.colorMask(true, true, true, true);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.viewport(0, 0, size[0] / xyf, size[1] / xyf);
      model.fvp = [
        Math.floor(size[0] / xyf) / Math.floor(size[0] * 0.7),
        Math.floor(size[1] / xyf) / Math.floor(size[1] * 0.7),
      ];
    }
    model.context.disable(model.context.DEPTH_TEST);

    // make sure the BOs are up to date
    publicAPI.updateBufferObjects(ren, actors);

    // Bind the OpenGL, this is shared between the different primitive/cell types.
    model.lastBoundBO = null;

    // if we have a zbuffer texture then activate it
    if (model.zBufferTexture !== null) {
      model.zBufferTexture.activate();
    }
  };

  publicAPI.renderPieceDraw = (ren, actors) => {
    console.warn('renderPieceDraw');
    const gl = model.context;

    // render the texture
    model.perVol.forEach(({ scalarTexture }) => {
      scalarTexture.activate();
    });

    model.opacityTexture.activate();
    model.colorTexture.activate();
    model.jitterTexture.activate();

    publicAPI.updateShaders(model.tris, ren, actors);

    console.warn('model.perVol');
    console.warn(model.perVol);

    // First we do the triangles, update the shader, set uniforms, etc.
    gl.drawArrays(gl.TRIANGLES, 0, model.tris.getCABO().getElementCount());
    model.tris.getVAO().release();

    model.perVol.forEach(({ scalarTexture }) => {
      scalarTexture.deactivate();
    });
    model.colorTexture.deactivate();
    model.opacityTexture.deactivate();
    model.jitterTexture.deactivate();
  };

  publicAPI.renderPieceFinish = (ren, actors) => {
    console.warn('renderPieceFinish');

    // if we have a zbuffer texture then deactivate it
    if (model.zBufferTexture !== null) {
      model.zBufferTexture.deactivate();
    }

    if (model.lastXYF > 1.43) {
      // now copy the frambuffer with the volume into the
      // regular buffer
      model.framebuffer.restorePreviousBindingsAndBuffers();

      if (model.copyShader === null) {
        model.copyShader = model.openGLRenderWindow
          .getShaderCache()
          .readyShaderProgramArray(
            [
              '//VTK::System::Dec',
              'attribute vec4 vertexDC;',
              'uniform vec2 tfactor;',
              'varying vec2 tcoord;',
              'void main() { tcoord = vec2(vertexDC.x*0.5 + 0.5, vertexDC.y*0.5 + 0.5) * tfactor; gl_Position = vertexDC; }',
            ].join('\n'),
            [
              '//VTK::System::Dec',
              '//VTK::Output::Dec',
              'uniform sampler2D texture1;',
              'varying vec2 tcoord;',
              'void main() { gl_FragData[0] = texture2D(texture1,tcoord); }',
            ].join('\n'),
            ''
          );
        const program = model.copyShader;

        model.copyVAO = vtkVertexArrayObject.newInstance();
        model.copyVAO.setOpenGLRenderWindow(model.openGLRenderWindow);

        model.tris.getCABO().bind();
        if (
          !model.copyVAO.addAttributeArray(
            program,
            model.tris.getCABO(),
            'vertexDC',
            model.tris.getCABO().getVertexOffset(),
            model.tris.getCABO().getStride(),
            model.context.FLOAT,
            3,
            model.context.FALSE
          )
        ) {
          vtkErrorMacro('Error setting vertexDC in copy shader VAO.');
        }
      } else {
        model.openGLRenderWindow
          .getShaderCache()
          .readyShaderProgram(model.copyShader);
      }

      const size = model.openGLRenderWindow.getFramebufferSize();
      model.context.viewport(0, 0, size[0], size[1]);

      // activate texture
      const tex = model.framebuffer.getColorTexture();
      tex.activate();
      model.copyShader.setUniformi('texture', tex.getTextureUnit());

      model.copyShader.setUniform2f('tfactor', model.fvp[0], model.fvp[1]);

      const gl = model.context;
      gl.blendFuncSeparate(
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );

      // render quad
      model.context.drawArrays(
        model.context.TRIANGLES,
        0,
        model.tris.getCABO().getElementCount()
      );
      tex.deactivate();

      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );
    }
  };

  publicAPI.renderPiece = (ren, actors) => {
    console.warn('renderPiece');
    if (!actors || !actors.length) {
      vtkErrorMacro('No input!');
      return;
    }

    publicAPI.renderPieceStart(ren, actors);
    publicAPI.renderPieceDraw(ren, actors);
    publicAPI.renderPieceFinish(ren, actors);

    const gl = model.context;
    const program = model.lastBoundBO.getProgram().getHandle();

    console.warn(
      JSON.stringify(publicAPI.getProgramInfo(gl, program), null, 2)
    );
  };

  publicAPI.computeBounds = (ren, actors) => {
    if (!publicAPI.getInput()) {
      vtkMath.uninitializeBounds(model.Bounds);
      return;
    }
    model.bounds = publicAPI.getInput().getBounds();
  };

  publicAPI.updateBufferObjects = (ren, actors) => {
    console.warn('updateBufferObjects');
    // Rebuild buffers if needed
    if (publicAPI.getNeedToRebuildBufferObjects(ren, actors)) {
      publicAPI.buildBufferObjects(ren, actors);
    }
  };

  publicAPI.getNeedToRebuildBufferObjects = (ren, actors) => {
    console.warn('getNeedToRebuildBufferObjects');
    const actorMTimes = actors.map((a) => a.getMTime());
    const actorPropertyMTimes = actors.map((a) => a.getProperty().getMTime());
    const latestActorPropertyMTime = Math.max(...actorPropertyMTimes);
    const latestActorMTime = Math.max(...actorMTimes);
    const vboBuildMTime = model.VBOBuildTime.getMTime();
    // first do a coarse check

    return (
      vboBuildMTime < publicAPI.getMTime() ||
      vboBuildMTime < latestActorMTime() ||
      vboBuildMTime < model.renderable.getMTime() ||
      vboBuildMTime < latestActorPropertyMTime
    );
  };

  function rebuildOpacityTransferFunctionTexture(actors) {
    // Build an array of objects storing the opacity tables
    // and opacity table lengths
    const oWidth = 1024;

    // Compute the total length required to store the opacity
    // transfer functions for each volume.
    //
    // The function returns the required size based on the number
    // of independent components in the image data.
    const oSizePerVolume = actors.map((actor) => {
      const vprop = actor.getProperty();
      const iComps = vprop.getIndependentComponents();
      const imageData = actor.getMapper().getInputData();
      const numComp = imageData
        .getPointData()
        .getScalars()
        .getNumberOfComponents();
      const numIComps = iComps ? numComp : 1;

      return oWidth * 2 * numIComps;
    });

    // We are making a 2d texture of N x M
    // N will be the maximum cSize for the displayed volumes
    // e.g. if all volumes have 1 component, it will be 6 * 1024
    // if any volume has more components, the width of the texture
    // will grow. This may not be the best approach?
    const oSizeMax = Math.max(...oSizePerVolume);

    // We can then allocate the correct size buffer for the color
    // lookup table
    const numVolumes = actors.length;
    const combinedOTableFloat = new Float32Array(oSizeMax * numVolumes);

    let mostRecentMTime = 0;

    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      const actor = actors[volIdx];
      const vprop = actor.getProperty();
      const imageData = actor.getMapper().getInputData();
      const offset = oSizeMax * volIdx;
      const ofTable = new Float32Array(
        combinedOTableFloat.buffer,
        offset,
        oSizeMax
      );
      const tmpTable = new Float32Array(oWidth);
      const iComps = vprop.getIndependentComponents();
      const numComp = imageData
        .getPointData()
        .getScalars()
        .getNumberOfComponents();
      const numIComps = iComps ? numComp : 1;

      for (let c = 0; c < numIComps; ++c) {
        const ofun = vprop.getScalarOpacity(c);
        const opacityFactor = 1 / vprop.getScalarOpacityUnitDistance(c);

        const oRange = ofun.getRange();
        ofun.getTable(oRange[0], oRange[1], oWidth, tmpTable, 1);
        // adjust for sample distance etc
        for (let i = 0; i < oWidth; ++i) {
          ofTable[c * oWidth * 2 + i] =
            1.0 - (1.0 - tmpTable[i]) ** opacityFactor;
          ofTable[c * oWidth * 2 + i + oWidth] = ofTable[c * oWidth * 2 + i];
        }
      }

      // We will store the modified time for the combined color LUT texture
      // as the most recently modified volume property
      mostRecentMTime = Math.max(mostRecentMTime, vprop.getMTime());
    }

    model.opacityTexture.releaseGraphicsResources(model.openGLRenderWindow);
    model.opacityTexture.setMinificationFilter(Filter.LINEAR);
    model.opacityTexture.setMagnificationFilter(Filter.LINEAR);

    // use float texture where possible because we really need the resolution
    // for this table. Errors in low values of opacity accumulate to
    // visible artifacts. High values of opacity quickly terminate without
    // artifacts.
    if (
      model.openGLRenderWindow.getWebgl2() ||
      (model.context.getExtension('OES_texture_float') &&
        model.context.getExtension('OES_texture_float_linear'))
    ) {
      model.opacityTexture.create2DFromRaw(
        oSizeMax,
        numVolumes,
        1,
        VtkDataTypes.FLOAT,
        combinedOTableFloat
      );
    } else {
      const oTable = new Uint8Array(combinedOTableFloat.length);
      for (let i = 0; i < oSizeMax; ++i) {
        oTable[i] = 255.0 * combinedOTableFloat[i];
      }
      model.opacityTexture.create2DFromRaw(
        oSizeMax,
        numVolumes,
        1,
        VtkDataTypes.UNSIGNED_CHAR,
        oTable
      );
    }

    model.opacityTextureMTime = mostRecentMTime;
  }

  function rebuildColorTransferFunctionTexture(actors) {
    // Build an array of objects storing the color tables
    // and color table lengths
    const cWidth = 1024;

    // Compute the total length required to store the color
    // transfer functions for each volume.
    //
    // The function returns the required size based on the number
    // of independent components in the image data.
    const cSizePerVolume = actors.map((actor) => {
      const vprop = actor.getProperty();
      const iComps = vprop.getIndependentComponents();
      const imageData = actor.getMapper().getInputData();
      const numComp = imageData
        .getPointData()
        .getScalars()
        .getNumberOfComponents();
      const numIComps = iComps ? numComp : 1;

      return cWidth * 2 * numIComps * 3;
    });

    // We are making a 2d texture of N x M
    // N will be the maximum cSize for the displayed volumes
    // e.g. if all volumes have 1 component, it will be 6 * 1024
    // if any volume has more components, the width of the texture
    // will grow. This may not be the best approach?
    const cSizeMax = Math.max(...cSizePerVolume);

    // We can then allocate the correct size buffer for the color
    // lookup table
    const numVolumes = actors.length;
    const combinedCTable = new Uint8Array(cSizeMax * numVolumes);

    let mostRecentMTime = 0;

    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      const actor = actors[volIdx];
      const vprop = actor.getProperty();
      const iComps = vprop.getIndependentComponents();
      const imageData = actor.getMapper().getInputData();
      const numComp = imageData
        .getPointData()
        .getScalars()
        .getNumberOfComponents();
      const numIComps = iComps ? numComp : 1;
      const offset = cSizeMax * volIdx;

      // Create a new array view on the combined color table buffer
      const cTable = new Uint8Array(combinedCTable.buffer, offset, cSizeMax);
      const tmpTable = new Float32Array(cWidth * 3);

      for (let c = 0; c < numIComps; ++c) {
        const cfun = vprop.getRGBTransferFunction(c);

        const cRange = cfun.getRange();
        cfun.getTable(cRange[0], cRange[1], cWidth, tmpTable, 1);
        for (let i = 0; i < cWidth * 3; ++i) {
          cTable[c * cWidth * 6 + i] = 255.0 * tmpTable[i];
          cTable[c * cWidth * 6 + i + cWidth * 3] = 255.0 * tmpTable[i];
        }
      }

      // We will store the modified time for the combined color LUT texture
      // as the most recently modified volume property
      mostRecentMTime = Math.max(mostRecentMTime, vprop.getMTime());
    }

    model.colorTexture.releaseGraphicsResources(model.openGLRenderWindow);
    model.colorTexture.setMinificationFilter(Filter.LINEAR);
    model.colorTexture.setMagnificationFilter(Filter.LINEAR);

    // TODO[multivolume]: No idea if this is set correctly yet
    model.colorTexture.create2DFromRaw(
      cSizeMax,
      actors.length,
      1,
      VtkDataTypes.UNSIGNED_CHAR,
      combinedCTable
    );

    model.colorTextureMTime = mostRecentMTime;
  }

  publicAPI.buildBufferObjects = (ren, actors) => {
    console.warn('buildBufferObjects');

    if (!actors.length) {
      return;
    }

    if (!model.jitterTexture.getHandle()) {
      const oTable = new Uint8Array(32 * 32);
      for (let i = 0; i < 32 * 32; ++i) {
        oTable[i] = 255.0 * Math.random();
      }
      model.jitterTexture.setMinificationFilter(Filter.LINEAR);
      model.jitterTexture.setMagnificationFilter(Filter.LINEAR);
      model.jitterTexture.create2DFromRaw(
        32,
        32,
        1,
        VtkDataTypes.UNSIGNED_CHAR,
        oTable
      );
    }

    if (!model.colorTextureMTime) {
      rebuildColorTransferFunctionTexture(actors);
    }

    if (!model.opacityTextureMTime) {
      rebuildOpacityTransferFunctionTexture(actors);
    }

    const numVolumes = actors.length;
    const needToRebuildTexture = {
      opacity: false,
      color: false,
    };
    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      const volumeData = {};
      const actor = actors[volIdx];
      const imageData = actor.getMapper().getInputData();
      const dims = imageData.getDimensions();
      const numComp = imageData
        .getPointData()
        .getScalars()
        .getNumberOfComponents();

      // TODO[multivolume] Stupid question: If we modify these,
      //  are they modified in the object as well?
      let { scalarTexture, scalarTextureMTime } = volumeData;
      const { opacityTextureMTime, colorTextureMTime } = volumeData;

      const vprop = actor.getProperty();
      // If any volumeProperty has been modified more recently than
      // the last time the combined opacity texture was created,
      // we need to rebuild the texture
      if (
        vprop.getMTime() > opacityTextureMTime &&
        !needToRebuildTexture.opacity
      ) {
        needToRebuildTexture.opacity = true;
      }

      // If any volumeProperty has been modified more recently than
      // the last time the combined color texture was created,
      // we need to rebuild the texture
      //
      // TODO[multivolume]: Can't we check the vprop.colorTransferFn
      // instead of just the volume prop?
      if (vprop.getMTime() > colorTextureMTime && !needToRebuildTexture.color) {
        needToRebuildTexture.color = true;
      }

      // If the image data backing the volume actor has been modified
      // more recently than the last time the combined color texture
      // was created, we need to rebuild the texture
      if (
        !scalarTexture ||
        (scalarTextureMTime !== imageData.getMTime() &&
          !needToRebuildTexture.scalar)
      ) {
        if (!scalarTexture) {
          scalarTexture = vtkOpenGLTexture.newInstance();
          scalarTexture.setOpenGLRenderWindow(model.openGLRenderWindow);

          // set interpolation on the texture based on property setting
          const iType = vprop.getInterpolationType();
          if (iType === InterpolationType.NEAREST) {
            scalarTexture.setMinificationFilter(Filter.NEAREST);
            scalarTexture.setMagnificationFilter(Filter.NEAREST);
          } else {
            scalarTexture.setMinificationFilter(Filter.LINEAR);
            scalarTexture.setMagnificationFilter(Filter.LINEAR);
          }
        } else {
          scalarTexture.releaseGraphicsResources(model.openGLRenderWindow);
          scalarTexture.resetFormatAndType();
        }

        scalarTexture.releaseGraphicsResources(model.openGLRenderWindow);
        scalarTexture.resetFormatAndType();

        scalarTexture.create3DFilterableFromRaw(
          dims[0],
          dims[1],
          dims[2],
          numComp,
          imageData
            .getPointData()
            .getScalars()
            .getDataType(),
          imageData
            .getPointData()
            .getScalars()
            .getData()
        );

        scalarTextureMTime = imageData.getMTime();
      }

      volumeData.scalarTexture = scalarTexture;
      volumeData.scalarTextureMTime = scalarTextureMTime;
      volumeData.opacityTextureMTime = opacityTextureMTime;
      volumeData.colorTextureMTime = colorTextureMTime;

      model.perVol[volIdx] = Object.assign(
        {},
        model.perVol[volIdx],
        volumeData
      );
    }

    if (needToRebuildTexture.opacity) {
      rebuildOpacityTransferFunctionTexture(actors);
    }

    if (needToRebuildTexture.color) {
      rebuildColorTransferFunctionTexture(actors);
    }

    if (!model.tris.getCABO().getElementCount()) {
      // build the CABO
      const ptsArray = new Float32Array(12);
      for (let i = 0; i < 4; i++) {
        ptsArray[i * 3] = (i % 2) * 2 - 1.0;
        ptsArray[i * 3 + 1] = i > 1 ? 1.0 : -1.0;
        ptsArray[i * 3 + 2] = -1.0;
      }

      const cellArray = new Uint16Array(8);
      cellArray[0] = 3;
      cellArray[1] = 0;
      cellArray[2] = 1;
      cellArray[3] = 3;
      cellArray[4] = 3;
      cellArray[5] = 0;
      cellArray[6] = 3;
      cellArray[7] = 2;

      const points = vtkDataArray.newInstance({
        numberOfComponents: 3,
        values: ptsArray,
      });
      points.setName('points');
      const cells = vtkDataArray.newInstance({
        numberOfComponents: 1,
        values: cellArray,
      });
      model.tris.getCABO().createVBO(cells, 'polys', Representation.SURFACE, {
        points,
        cellOffset: 0,
      });
    }

    model.VBOBuildTime.modified();
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  context: null,
  VBOBuildTime: null,
  jitterTexture: null,
  tris: null,
  framebuffer: null,
  copyShader: null,
  copyVAO: null,
  lastXYF: 1.0,
  targetXYF: 1.0,
  zBufferTexture: null,
  lastZBufferTexture: null,
  lastLightComplexity: 0,
  fullViewportTime: 1.0,
  avgWindowArea: 0.0,
  avgFrameTime: 0.0,

  volumes: [],
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Inheritance
  vtkViewNode.extend(publicAPI, model, initialValues);

  model.VBOBuildTime = {};
  macro.obj(model.VBOBuildTime, { mtime: 0 });

  model.keyMatrixTime = {};
  macro.obj(model.keyMatrixTime, { mtime: 0 });

  model.tris = vtkHelper.newInstance();

  // Per actor
  model.perVol = [];

  model.opacityTexture = vtkOpenGLTexture.newInstance();
  model.colorTexture = vtkOpenGLTexture.newInstance();

  // Per scene
  model.jitterTexture = vtkOpenGLTexture.newInstance();
  model.jitterTexture.setWrapS(Wrap.REPEAT);
  model.jitterTexture.setWrapT(Wrap.REPEAT);
  model.framebuffer = vtkOpenGLFramebuffer.newInstance();

  // Build VTK API
  macro.setGet(publicAPI, model, ['context', 'volumes']);

  // Object methods
  vtkOpenGLMultiVolumeMapper(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkOpenGLMultiVolumeMapper'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };