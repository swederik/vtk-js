/* eslint no-debugger: 0 no-unused-vars:0  */
import macro from 'vtk.js/Sources/macro';
import { vec3, mat3, mat4 } from 'gl-matrix';
// import vtkBoundingBox       from 'vtk.js/Sources/Common/DataModel/BoundingBox';
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
import { BlendMode } from 'vtk.js/Sources/Rendering/Core/VolumeMapper/Constants';

import vtkVolumeVS from 'vtk.js/Sources/Rendering/OpenGL/glsl/vtkVolumeVS.glsl';

const { vtkWarningMacro, vtkErrorMacro } = macro;

// ----------------------------------------------------------------------------
// vtkOpenGLVolumeMapper methods
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

      const actors = model.renderable.getVolumes();

      actors.forEach((actor, volIdx) => {
        model.perVol[volIdx] = model.perVol[volIdx] || {};

        if (!model.perVol[volIdx].scalarTexture) {
          model.perVol[volIdx].scalarTexture = vtkOpenGLTexture.newInstance();
        }

        if (!model.perVol[volIdx].opacityTexture) {
          model.perVol[volIdx].opacityTexture = vtkOpenGLTexture.newInstance();
        }

        if (!model.perVol[volIdx].colorTexture) {
          model.perVol[volIdx].colorTexture = vtkOpenGLTexture.newInstance();
        }

        model.perVol[volIdx].scalarTexture.setOpenGLRenderWindow(
          model.openGLRenderWindow
        );
        model.perVol[volIdx].colorTexture.setOpenGLRenderWindow(
          model.openGLRenderWindow
        );
        model.perVol[volIdx].opacityTexture.setOpenGLRenderWindow(
          model.openGLRenderWindow
        );
      });

      publicAPI.renderPiece(ren, actors);
    }
  };

  publicAPI.buildShaders = (shaders, ren, actors) => {
    publicAPI.getShaderTemplate(shaders, ren, actors);
    publicAPI.createFragmentShader(shaders, ren, actors);
    publicAPI.replaceShaderValues(shaders, ren, actors);
  };

  function getUniformDefinitions(i, numComp) {
    let uniformDefinitions = `
        uniform ivec3 volumeDimensions_${i};
        uniform vec3 vOriginVC_${i};
        uniform vec3 vSpacing_${i};
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
        uniform vec3 vVCToIJK_${i};
      `;

    // Opacity and Color shifts
    uniformDefinitions += `
        uniform float oshift0_${i};
        uniform float oscale0_${i};
        uniform float cshift0_${i};
        uniform float cscale0_${i};
      `;

    // Lighting
    uniformDefinitions += `
        uniform float vSpecularPower_${i};
        uniform float vAmbient_${i};
        uniform float vDiffuse_${i};
        uniform float vSpecular_${i};
      `;

    uniformDefinitions += `
        uniform highp sampler3D texture${i + 1};
        
        // opacity and color textures
        uniform sampler2D otexture${i + 1};
        uniform sampler2D ctexture${i + 1};
      `;

    // the heights defined below are the locations
    // for the up to four components of the tfuns
    // the tfuns have a height of 2XnumComps pixels so the
    // values are computed to hit the middle of the two rows
    // for that component
    const vtkIndependentComponentsOn = false;
    if (vtkIndependentComponentsOn) {
      if (numComp === 2) {
        uniformDefinitions += `
          uniform float mix0_${i};
          uniform float mix1_${i};
          #define height0_${i} 0.25
          #define height1_${i} 0.75`;
      } else if (numComp === 3) {
        uniformDefinitions += `
          uniform float mix0_${i};
          uniform float mix1_${i};
          uniform float mix2_${i};
          #define height0_${i} 0.17
          #define height1_${i} 0.5
          #define height2_${i}0.83`;
      } else if (numComp === 4) {
        uniformDefinitions += `
          uniform float mix0_${i};
          uniform float mix1_${i};
          uniform float mix2_${i};
          uniform float mix3_${i};
          #define height0_${i} 0.125
          #define height1_${i} 0.375
          #define height2_${i} 0.625
          #define height3_${i} 0.875`;
      }
    }

    if (numComp >= 2) {
      uniformDefinitions += `
        uniform float oshift1_${i};
        uniform float oscale1_${i};
        uniform float cshift1_${i};
        uniform float cscale1_${i};`;
    }

    if (numComp >= 3) {
      uniformDefinitions += `
        uniform float oshift2_${i};
        uniform float oscale2_${i};
        uniform float cshift2_${i};
        uniform float cscale2_${i};`;
    }

    if (numComp >= 4) {
      uniformDefinitions += `
        uniform float oshift3_${i};
        uniform float oscale3_${i};
        uniform float cshift3_${i};
        uniform float cscale3_${i};`;
    }

    // possibly define vtkGradientOpacityOn
    if (model.perVol[i].gopacity) {
      uniformDefinitions += `
        uniform float goscale0_${i};
        uniform float goshift0_${i};
        uniform float gomin0_${i};
        uniform float gomax0_${i};
      `;

      if (vtkIndependentComponentsOn && numComp >= 2) {
        uniformDefinitions += `
          uniform float goscale1_${i};
          uniform float goshift1_${i};
          uniform float gomin1_${i};
          uniform float gomax1_${i};
        `;

        if (numComp >= 3) {
          uniformDefinitions += `
          uniform float goscale2_${i};
          uniform float goshift2_${i};
          uniform float gomin2_${i};
          uniform float gomax2_${i};
        `;
        }

        if (numComp >= 4) {
          uniformDefinitions += `
          uniform float goscale3_${i};
          uniform float goshift3_${i};
          uniform float gomin3_${i};
          uniform float gomax3_${i};
        `;
        }
      }
    }

    return uniformDefinitions;
  }

  function getGetTextureValue(i, numComp) {
    let texValueForNumComp;
    if (numComp === 1) {
      texValueForNumComp = 'tmp.a = tmp.r;';
    } else if (numComp === 2) {
      texValueForNumComp = 'tmp.a = tmp.g;';
    } else if (numComp === 3) {
      texValueForNumComp = 'tmp.a = length(tmp.rgb);';
    }
    return `
        vec4 getTextureValue_${i}(vec3 pos)
        {
          vec4 tmp = texture(texture${i + 1}, pos);
          ${texValueForNumComp}
          return tmp;
        }
      `;
  }

  function getComputeNormal(i, numComp) {
    return `
      vec4 computeNormal_${i}(vec3 pos, float scalar, vec3 tstep)
      {
        vec4 result;
      
        result.x = getTextureValue_${i}(pos + vec3(tstep.x, 0.0, 0.0)).a - scalar;
        result.y = getTextureValue_${i}(pos + vec3(0.0, tstep.y, 0.0)).a - scalar;
        result.z = getTextureValue_${i}(pos + vec3(0.0, 0.0, tstep.z)).a - scalar;
      
        // divide by spacing
        result.xyz /= vSpacing_${i};
      
        result.w = length(result.xyz);
      
        // rotate to View Coords
        result.xyz =
        result.x * vPlaneNormal0_${i} +
        result.y * vPlaneNormal2_${i} +
        result.z * vPlaneNormal4_${i};
      
        if (result.w > 0.0) {
          result.xyz /= result.w;
        }
        return result;
      }`;
  }

  function getComputeMat4Normal(i, numComp) {
    let computeMat4Normal = `
      mat4 computeMat4Normal_${i}(vec3 pos, vec4 tValue, vec3 tstep)
      {
        mat4 result;
        vec4 distX = getTextureValue_${i}(pos + vec3(tstep.x, 0.0, 0.0)) - tValue;
        vec4 distY = getTextureValue_${i}(pos + vec3(0.0, tstep.y, 0.0)) - tValue;
        vec4 distZ = getTextureValue_${i}(pos + vec3(0.0, 0.0, tstep.z)) - tValue;
      
        // divide by spacing
        distX /= vSpacing_${i}.x;
        distY /= vSpacing_${i}.y;
        distZ /= vSpacing_${i}.z;
      
        mat3 rot;
        rot[0] = vPlaneNormal0_${i};
        rot[1] = vPlaneNormal2_${i};
        rot[2] = vPlaneNormal4_${i};
      
        result[0].xyz = vec3(distX.r, distY.r, distZ.r);
        result[0].a = length(result[0].xyz);
        result[0].xyz *= rot;
        if (result[0].w > 0.0) {
          result[0].xyz /= result[0].w;
        }
      
        result[1].xyz = vec3(distX.g, distY.g, distZ.g);
        result[1].a = length(result[1].xyz);
        result[1].xyz *= rot;
        if (result[1].w > 0.0) {
          result[1].xyz /= result[1].w;
        }
      
        `;

    // optionally compute the 3rd component
    if (numComp >= 3) {
      computeMat4Normal += `
          result[2].xyz = vec3(distX.b, distY.b, distZ.b);
          result[2].a = length(result[2].xyz);
          result[2].xyz *= rot;
          if (result[2].w > 0.0) {
            result[2].xyz /= result[2].w;
          }
        `;
    }

    // optionally compute the 4th component
    if (numComp >= 4) {
      computeMat4Normal += `
        result[3].xyz = vec3(distX.a, distY.a, distZ.a);
        result[3].a = length(result[3].xyz);
        result[3].xyz *= rot;
        if (result[3].w > 0.0) {
          result[3].xyz /= result[3].w;
        }
        `;
    }

    computeMat4Normal += `
        return result;
      }`;

    return computeMat4Normal;
  }

  function getComputeGradientOpacityFactor(i) {
    // Given a normal compute the gradient opacity factors
    let result;
    if (model.perVol[i].gradientOpacity) {
      result = `return clamp(normal.a*goscale + goshift, gomin, gomax)`;
    } else {
      result = `return 1.0;`;
    }

    return `
      float computeGradientOpacityFactor_${i}(
        vec4 normal, float goscale, float goshift, float gomin, float gomax)
      {
        ${result}
      }
    `;
  }

  function getApplyLighting(i) {
    return ` 
      #if vtkLightComplexity > 0
      void applyLighting_${i}(inout vec3 tColor, vec4 normal)
      {
        vec3 diffuse = vec3(0.0, 0.0, 0.0);
        vec3 specular = vec3(0.0, 0.0, 0.0);
        //VTK::Light::Impl
        tColor.rgb = tColor.rgb*(diffuse * vDiffuse_${i} + vAmbient_${i}) + specular * vSpecular_${i};
      }
      #endif
    `;
  }

  function getGetColorForValue(i, numComp) {
    const vtkIndependentComponentsOn = false;
    let normalMatAndVecDefinitions = '';
    if (vtkIndependentComponentsOn && numComp > 1) {
      if (numComp > 1) {
        normalMatAndVecDefinitions += `
        mat4 normalMat = computeMat4Normal_${i}(posIS, tValue, tstep);
        vec4 normal0 = normalMat[0];
        vec4 normal1 = normalMat[1];
      `;
      }

      if (numComp > 2) {
        normalMatAndVecDefinitions += `
        vec4 normal2 = normalMat[2];
      `;
      }

      if (numComp > 3) {
        normalMatAndVecDefinitions += `
        vec4 normal3 = normalMat[3];
      `;
      }
    } else {
      normalMatAndVecDefinitions += `vec4 normal0 = computeNormal_${i}(posIS, tValue.a, tstep);`;
    }

    const normalVectors = `
    #if (vtkLightComplexity > 0) || defined(vtkGradientOpacityOn)
      ${normalMatAndVecDefinitions}
    #endif
    `;

    let gradientOpacityFactors = '';
    if (model.perVol[i].gopacity) {
      gradientOpacityFactors += ` 
        goFactor.x =
          computeGradientOpacityFactor_${i}(normal0, goscale0_${i}, goshift0_${i}, gomin0_${i}, gomax0_${i});
      `;

      if (vtkIndependentComponentsOn) {
        if (numComp > 1) {
          gradientOpacityFactors += `
            goFactor.y =
            computeGradientOpacityFactor_${i}(normal1, goscale1_${i}, goshift1_${i}, gomin1_${i}, gomax1_${i});
          `;
        }
        if (numComp > 2) {
          gradientOpacityFactors += `
            goFactor.z =
            computeGradientOpacityFactor_${i}(normal2, goscale2_${i}, goshift2_${i}, gomin2_${i}, gomax2_${i});
          `;
        }
        if (numComp > 3) {
          gradientOpacityFactors += `
            goFactor.w =
            computeGradientOpacityFactor_${i}(normal3, goscale3_${i}, goshift3_${i}, gomin3_${i}, gomax3_${i});
          `;
        }
      }
    }

    let tColor = '';
    if (numComp === 1) {
      // single component is always independent
      tColor += `
        vec4 tColor = texture2D(ctexture${i +
          1}, vec2(tValue.r * cscale0_${i} + cshift0_${i}, 0.5));
        tColor.a = goFactor.x*texture2D(otexture${i +
          1}, vec2(tValue.r * oscale0_${i} + oshift0_${i}, 0.5)).r;
      `;
    } else if (vtkIndependentComponentsOn && numComp >= 2) {
      tColor += `
      vec4 tColor = mix0*texture2D(ctexture${i +
        1}, vec2(tValue.r * cscale0_${i} + cshift0_${i}, height0_${i}));
      tColor.a = goFactor.x*mix0*texture2D(otexture${i +
        1}, vec2(tValue.r * oscale0_${i} + oshift0_${i}, height0_${i})).r;
      vec3 tColor1 = mix1*texture2D(ctexture${i +
        1}, vec2(tValue.g * cscale1_${i} + cshift1_${i}, height1_${i})).rgb;
      tColor.a += goFactor.y*mix1*texture2D(otexture${i +
        1}, vec2(tValue.g * oscale1_${i} + oshift1_${i}, height1_${i})).r;`;

      if (numComp >= 3) {
        tColor += `
        vec3 tColor2 = mix2*texture2D(ctexture${i +
          1}, vec2(tValue.b * cscale2_${i} + cshift2_${i}, height2_${i})).rgb;
        tColor.a += goFactor.z*mix2*texture2D(otexture${i +
          1}, vec2(tValue.b * oscale2_${i} + oshift2_${i}, height2_${i})).r;`;
      }

      if (numComp >= 4) {
        tColor += `
        vec3 tColor3 = mix3*texture2D(ctexture${i +
          1}, vec2(tValue.a * cscale3_${i} + cshift3_${i}, height3_${i})).rgb;
        tColor.a += goFactor.w*mix3*texture2D(otexture${i +
          1}, vec2(tValue.a * oscale3_${i} + oshift3_${i}, height3_${i})).r;`;
      }
    } else if (numComp === 2) {
      // not independent
      tColor += `
        float lum = tValue.r * cscale0_${i} + cshift0_${i};
        float alpha = goFactor.x*texture2D(otexture${i +
          1}, vec2(tValue.a * oscale1_${i} + oshift1_${i}, 0.5)).r;
        vec4 tColor = vec4(lum, lum, lum, alpha);
        `;
    } else if (numComp === 3) {
      // not independent
      tColor += `
        tColor.r = tValue.r * cscale0_${i} + cshift0_${i};
        tColor.g = tValue.g * cscale1_${i} + cshift1_${i};
        tColor.b = tValue.b * cscale2_${i} + cshift2_${i};
        tColor.a = goFactor.x*texture2D(otexture${i +
          1}, vec2(tValue.a * oscale0_${i} + oshift0_${i}, 0.5)).r;
        `;
    } else if (numComp === 4) {
      // not independent
      tColor += `
          tColor.r = tValue.r * cscale0_${i} + cshift0_${i};
          tColor.g = tValue.g * cscale1_${i} + cshift1_${i};
          tColor.b = tValue.b * cscale2_${i} + cshift2_${i};
          tColor.a = goFactor.x*texture2D(otexture${i +
            1}, vec2(tValue.a * oscale3_${i} + oshift3_${i}, 0.5)).r;
        `;
    }

    let applyLighting = `
      #if defined(vtkLightComplexity) && vtkLightComplexity > 0
      
      applyLighting_${i}(tColor.rgb, normal0);
    `;

    if (vtkIndependentComponentsOn && numComp >= 2) {
      applyLighting += `
          applyLighting_${i}(tColor1, normal1);
        `;
      if (numComp >= 3) {
        applyLighting += `
          applyLighting_${i}(tColor2, normal2);
        `;
      }

      if (numComp >= 4) {
        applyLighting += `
          applyLighting_${i}(tColor3, normal3);
        `;
      }
    }

    applyLighting += `#endif
    `;

    let finalIndependentBlend = '';
    if (vtkIndependentComponentsOn && numComp >= 2) {
      finalIndependentBlend += `
        tColor.rgb += tColor1;
      `;

      if (numComp >= 3) {
        finalIndependentBlend += `
          tColor.rgb += tColor2;
        `;
      }

      if (numComp >= 4) {
        finalIndependentBlend += `
          tColor.rgb += tColor3;
        `;
      }
    }

    // Given a texture value compute the color and opacity
    const getColorForValue = `
    vec4 getColorForValue_${i}(vec4 tValue, vec3 posIS, vec3 tstep)
    {
      // compute the normal and gradient magnitude if needed
      // We compute it as a vec4 if possible otherwise a mat4
      vec4 goFactor = vec4(1.0,1.0,1.0,1.0);
      // compute the normal vectors as needed
      ${normalVectors}
      // compute gradient opacity factors as needed
      ${gradientOpacityFactors}
      ${tColor}
      // apply lighting if requested as appropriate
      ${applyLighting}
      // perform final independent blend as needed
      ${finalIndependentBlend}
      return tColor;
    }`;

    return getColorForValue;
  }

  function getComputeIndexSpaceValues(i) {
    // Compute the index space starting position (pos) and end
    // position
    //
    return `void computeIndexSpaceValues_${i}(out vec3 pos, out vec3 endPos, out float sampleDistanceIS, vec3 rayDir, vec2 dists)
    {
      // compute starting and ending values in volume space
      pos = vertexVCVSOutput + dists.x*rayDir;
      pos = pos - vOriginVC_${i};
      // convert to volume basis and origin
      pos = vec3(
        dot(pos, vPlaneNormal0_${i}),
        dot(pos, vPlaneNormal2_${i}),
        dot(pos, vPlaneNormal4_${i}));

      endPos = vertexVCVSOutput + dists.y*rayDir;
      endPos = endPos - vOriginVC_${i};
      endPos = vec3(
        dot(endPos, vPlaneNormal0_${i}),
        dot(endPos, vPlaneNormal2_${i}),
        dot(endPos, vPlaneNormal4_${i}));

      float delta = length(endPos - pos);

      pos *= vVCToIJK_${i};
      endPos *= vVCToIJK_${i};

      float delta2 = length(endPos - pos);
      sampleDistanceIS = sampleDistance*delta2/delta;
    }`;
  }

  function getGetRayPointIntersectionBounds(i) {
    // Compute a new start and end point for a given ray based
    // on the provided bounded clipping plane (aka a rectangle)
    return `
    void getRayPointIntersectionBounds_${i}(
      vec3 rayPos, vec3 rayDir,
      vec3 planeDir, float planeDist,
      inout vec2 tbounds, vec3 vPlaneX, vec3 vPlaneY,
      float vSize1, float vSize2)
    {
      float result = dot(rayDir, planeDir);
      if (result == 0.0) {
        return;
      }
      result = -1.0 * (dot(rayPos, planeDir) + planeDist) / result;
      vec3 xposVC = rayPos + rayDir*result;
      vec3 vxpos = xposVC - vOriginVC_${i};
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
    }`;
  }

  function getComputeRayDistances(i) {
    return `
      // given a
      // - ray direction (rayDir)
      // - starting point (vertexVCVSOutput)
      // - bounding planes of the volume
      // - optionally depth buffer values
      // - far clipping plane
      // compute the start/end distances of the ray we need to cast
      vec2 computeRayDistances_${i}(vec3 rayDir, vec3 tdims)
      {
        vec2 dists = vec2(100.0*camFar, -1.0);

        vec3 vSize = vSpacing_${i}*(tdims - 1.0);

        // all this is in View Coordinates
        getRayPointIntersectionBounds_${i}(vertexVCVSOutput, rayDir,
        vPlaneNormal0_${i}, vPlaneDistance0_${i}, dists, vPlaneNormal2_${i}, vPlaneNormal4_${i},
        vSize.y, vSize.z);
        getRayPointIntersectionBounds_${i}(vertexVCVSOutput, rayDir,
        vPlaneNormal1_${i}, vPlaneDistance1_${i}, dists, vPlaneNormal2_${i}, vPlaneNormal4_${i},
        vSize.y, vSize.z);
        getRayPointIntersectionBounds_${i}(vertexVCVSOutput, rayDir,
        vPlaneNormal2_${i}, vPlaneDistance2_${i}, dists, vPlaneNormal0_${i}, vPlaneNormal4_${i},
        vSize.x, vSize.z);
        getRayPointIntersectionBounds_${i}(vertexVCVSOutput, rayDir,
        vPlaneNormal3_${i}, vPlaneDistance3_${i}, dists, vPlaneNormal0_${i}, vPlaneNormal4_${i},
        vSize.x, vSize.z);
        getRayPointIntersectionBounds_${i}(vertexVCVSOutput, rayDir,
        vPlaneNormal4_${i}, vPlaneDistance4_${i}, dists, vPlaneNormal0_${i}, vPlaneNormal2_${i},
        vSize.x, vSize.y);
        getRayPointIntersectionBounds_${i}(vertexVCVSOutput, rayDir,
        vPlaneNormal5_${i}, vPlaneDistance5_${i}, dists, vPlaneNormal0_${i}, vPlaneNormal2_${i},
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
    `;
  }

  function getApplyBlend(numVolumes) {
    const i = 0;
    // Apply the specified blend mode operation along the ray's path.
    return `
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
        tValue = getTextureValue_${i}(posIS);
  
        // COMPOSITE_BLEND
        // now map through opacity and color
        tColor = getColorForValue_${i}(tValue, posIS, tstep);
  
        // handle very thin volumes
        if (raySteps <= 1.0) {
          tColor.a = 1.0 - pow(1.0 - tColor.a, raySteps);
          gl_FragData[0] = tColor;
          return;
        }
  
        tColor.a = 1.0 - pow(1.0 - tColor.a, jitter);
        color = vec4(tColor.rgb*tColor.a, tColor.a);
        posIS += (jitter*stepIS);
  
        for (int i = 0; i < //VTK::MaximumSamplesValue ; ++i) {
          if (stepsTraveled + 1.0 >= raySteps) { break; }
    
          // compute the scalar
          tValue = getTextureValue_${i}(posIS);
    
          // now map through opacity and color
          tColor = getColorForValue_${i}(tValue, posIS, tstep);
    
          float mix = (1.0 - color.a);
    
          color = color + vec4(tColor.rgb*tColor.a, tColor.a)*mix;
          stepsTraveled++;
          posIS += stepIS;
          if (color.a > 0.99) { color.a = 1.0; break; }
        }
    
        if (color.a < 0.99 && (raySteps - stepsTraveled) > 0.0) {
          posIS = endIS;
    
          // compute the scalar
          tValue = getTextureValue_${i}(posIS);
    
          // now map through opacity and color
          tColor = getColorForValue_${i}(tValue, posIS, tstep);
          tColor.a = 1.0 - pow(1.0 - tColor.a, raySteps - stepsTraveled);
    
          float mix = (1.0 - color.a);
          color = color + vec4(tColor.rgb*tColor.a, tColor.a)*mix;
        }
    
        gl_FragData[0] = vec4(color.rgb/color.a, color.a);
      }`;
  }

  publicAPI.createFragmentShader = (shaders, ren, actors) => {
    const numVolumes = actors.length;
    const maxNumComponents = 1;

    const staticUniformDefinitions = `
      varying vec3 vertexVCVSOutput;
      
      // camera values
      uniform float camThick;
      uniform float camNear;
      uniform float camFar;
      uniform int cameraParallel;

      // jitter texture
      uniform sampler2D jtexture;
      uniform float sampleDistance;
      `;

    let uniformDefinitions = '';
    let getTextureValue = '';
    let computeNormal = '';
    let computeMat4Normal = '';
    let computeGradientOpacityFactor = '';
    let applyLighting = '';
    let getColorForValue = '';
    let getRayPointIntersectionBounds = '';
    let computeIndexSpaceValues = '';
    let computeRayDistances = '';

    for (let i = 0; i < numVolumes; i++) {
      const numComp = 1; // model.perVol[i].numComp

      uniformDefinitions += getUniformDefinitions(i, numComp);
      getTextureValue += getGetTextureValue(i, numComp);
      computeNormal += getComputeNormal(i);
      computeMat4Normal += getComputeMat4Normal(i, numComp);
      computeGradientOpacityFactor += getComputeGradientOpacityFactor(i);
      applyLighting += getApplyLighting(i);
      getColorForValue += getGetColorForValue(i, numComp);
      computeIndexSpaceValues += getComputeIndexSpaceValues(i);
      computeRayDistances += getComputeRayDistances(i);
      getRayPointIntersectionBounds += getGetRayPointIntersectionBounds(i);
    }

    const applyBlend = getApplyBlend(numVolumes);

    const fragShader = `//VTK::System::Dec

      // the output of this shader
      //VTK::Output::Dec

      ${staticUniformDefinitions}
      
      // first declare the settings from the mapper
      // that impact the code paths in here

      // possibly define vtkIndependentComponents
      //VTK::IndependentComponentsOn

      // define vtkLightComplexity
      //VTK::LightComplexity

      // values describing the volume geometry
      ${uniformDefinitions}

      // declaration for intermixed geometry
      //VTK::ZBuffer::Dec

      // Lighting values
      //VTK::Light::Dec

      ${getTextureValue}
      ${computeNormal}
      ${computeMat4Normal}
      ${computeGradientOpacityFactor}
      ${applyLighting}
      ${getColorForValue}
      ${applyBlend}
      ${getRayPointIntersectionBounds}
      ${computeRayDistances}
      ${computeIndexSpaceValues}

      void main() {
        vec3 rayDirVC;

        if (cameraParallel == 1) {
          // Camera is parallel, so the rayDir is just the direction of the camera.
          rayDirVC = vec3(0.0, 0.0, -1.0);
        } else {
          // camera is at 0,0,0 so rayDir for perspective is just the vc coord
          rayDirVC = normalize(vertexVCVSOutput);
        }

        vec3 tdims = vec3(volumeDimensions_0);

        // compute the start and end points for the ray
        vec2 rayStartEndDistancesVC = computeRayDistances_0(rayDirVC, tdims);

        // do we need to composite? aka does the ray have any length
        // If not, bail out early
        if (rayStartEndDistancesVC.y <= rayStartEndDistancesVC.x) {
          discard;
        }

        // IS = Index Space
        vec3 posIS;
        vec3 endIS;
        float sampleDistanceIS;
        computeIndexSpaceValues_0(posIS, endIS, sampleDistanceIS, rayDirVC, rayStartEndDistancesVC);

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
    const actor = actors[0];
    let FSSource = shaders.Fragment;

    const iComps = actor.getProperty().getIndependentComponents();
    if (iComps) {
      FSSource = vtkShaderProgram.substitute(
        FSSource,
        '//VTK::IndependentComponentsOn',
        '#define vtkIndependentComponentsOn'
      ).result;
    }

    // WebGL only supports loops over constants
    // and does not support while loops so we
    // have to hard code how many steps/samples to take
    // We do a break so most systems will gracefully
    // early terminate, but it is always possible
    // a system will execute every step regardless
    const ext = model.currentInput.getExtent();
    const spc = model.currentInput.getSpacing();
    const vsize = vec3.create();
    vec3.set(
      vsize,
      (ext[1] - ext[0]) * spc[0],
      (ext[3] - ext[2]) * spc[1],
      (ext[5] - ext[4]) * spc[2]
    );

    const sampleDist = 1;
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
    /* model.gopacity = actor.getProperty().getUseGradientOpacity(0);
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
    } */

    // if we have a ztexture then declare it and use it
    if (model.zBufferTexture !== null) {
      FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::ZBuffer::Dec', [
        'uniform sampler2D zBufferTexture;',
        'uniform float vpWidth;',
        'uniform float vpHeight;',
      ]).result;
      FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::ZBuffer::Impl', [
        'vec4 depthVec = texture2D(zBufferTexture, vec2(gl_FragCoord.x / vpWidth, gl_FragCoord.y/vpHeight));',
        'float zdepth = (depthVec.r*256.0 + depthVec.g)/257.0;',
        'zdepth = zdepth * 2.0 - 1.0;',
        'zdepth = -2.0 * camFar * camNear / (zdepth*(camFar-camNear)-(camFar+camNear)) - camNear;',
        'zdepth = -zdepth/rayDir.z;',
        'dists.y = min(zdepth,dists.y);',
      ]).result;
    }

    shaders.Fragment = FSSource;

    publicAPI.replaceShaderLight(shaders, ren, actors);
  };

  publicAPI.replaceShaderLight = (shaders, ren, actors) => {
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
      cellBO.getShaderSourceTime().getMTime() < model.renderable.getMTime() ||
      cellBO.getShaderSourceTime().getMTime() < model.currentInput.getMTime()
    ) {
      model.lastZBufferTexture = model.zBufferTexture;
      return true;
    }

    return false;
  };

  publicAPI.updateShaders = (cellBO, ren, actors) => {
    const actor = actors[0];
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
    publicAPI.setMapperShaderParameters(cellBO, ren, actors);
    publicAPI.setCameraShaderParameters(cellBO, ren, actors);
    publicAPI.setPropertyShaderParameters(cellBO, ren, actors);
  };

  publicAPI.setMapperShaderParameters = (cellBO, ren, actors) => {
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

    const sampleDist = 1; // model.renderable.getSampleDistance();
    actors.forEach((actor, volIdx) => {
      const { scalarTexture } = model.perVol[volIdx];

      program.setUniformi(
        `texture${volIdx + 1}`,
        scalarTexture.getTextureUnit()
      );
    });

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
    // // [WMVD]C == {world, model, view, display} coordinates
    // // E.g., WCDC == world to display coordinate transformation
    const keyMats = model.openGLCamera.getKeyMatrices(ren);
    publicAPI.getKeyMatrices(actors);

    const actMats = model.perVol[0].actMats;

    mat4.multiply(model.modelToView, keyMats.wcvc, actMats.mcwc);

    const program = cellBO.getProgram();

    const cam = model.openGLCamera.getRenderable();
    const crange = cam.getClippingRange();
    program.setUniformf('camThick', crange[1] - crange[0]);
    program.setUniformf('camNear', crange[0]);
    program.setUniformf('camFar', crange[1]);

    const bounds = model.currentInput.getBounds();
    const dims = model.currentInput.getDimensions();

    // compute the viewport bounds of the volume
    // we will only render those fragments.
    const pos = vec3.create();
    const dir = vec3.create();
    const dcxmin = 1.0;
    const dcxmax = -1.0;
    const dcymin = 1.0;
    const dcymax = -1.0;

    /* for (let i = 0; i < 8; ++i) {
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

    actors.forEach((actor, volIdx) => {
      const ext = model.currentInput.getExtent();
      const spc = model.currentInput.getSpacing();

      const vsize = vec3.create();
      vec3.set(
        vsize,
        (ext[1] - ext[0] + 1) * spc[0],
        (ext[3] - ext[2] + 1) * spc[1],
        (ext[5] - ext[4] + 1) * spc[2]
      );
      program.setUniform3f(`vSpacing_${volIdx}`, spc[0], spc[1], spc[2]);

      vec3.set(pos, ext[0], ext[2], ext[4]);
      model.currentInput.indexToWorldVec3(pos, pos);

      vec3.transformMat4(pos, pos, model.modelToView);
      program.setUniform3f(`vOriginVC_${volIdx}`, pos[0], pos[1], pos[2]);

      // apply the image directions
      const i2wmat4 = model.currentInput.getIndexToWorld();
      mat4.multiply(model.idxToView, model.modelToView, i2wmat4);

      mat3.multiply(
        model.idxNormalMatrix,
        keyMats.normalMatrix,
        actMats.normalMatrix
      );
      mat3.multiply(
        model.idxNormalMatrix,
        model.idxNormalMatrix,
        model.currentInput.getDirection()
      );

      const sampleDist = 1; // model.renderable.getSampleDistance();
      const maxSamples = vec3.length(vsize) / 1;
      if (maxSamples > 1000) {
        vtkWarningMacro(`The number of steps required ${Math.ceil(
          maxSamples
        )} is larger than the
        specified maximum number of steps ${1000}.
        Please either change the
        volumeMapper sampleDistance or its maximum number of samples.`);
      }

      const vctoijk = vec3.create();

      vec3.set(vctoijk, 1.0, 1.0, 1.0);
      vec3.divide(vctoijk, vctoijk, vsize);
      program.setUniform3f(
        `vVCToIJK_${volIdx}`,
        vctoijk[0],
        vctoijk[1],
        vctoijk[2]
      );
      program.setUniform3i(
        `volumeDimensions_${volIdx}`,
        dims[0],
        dims[1],
        dims[2]
      );

      // map normals through normal matrix
      // then use a point on the plane to compute the distance
      const normal = vec3.create();
      const pos2 = vec3.create();
      for (let i = 0; i < 6; ++i) {
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
        vec3.transformMat3(normal, normal, model.idxNormalMatrix);
        vec3.transformMat4(pos2, pos2, model.idxToView);
        const dist = -1.0 * vec3.dot(pos2, normal);

        // we have the plane in view coordinates
        // specify the planes in view coordinates
        program.setUniform3f(
          `vPlaneNormal${i}_${volIdx}`,
          normal[0],
          normal[1],
          normal[2]
        );
        program.setUniformf(`vPlaneDistance${i}_${volIdx}`, dist);
      }
    });

    mat4.invert(model.displayToView, keyMats.vcdc);
    program.setUniformMatrix('DCVCMatrix', model.displayToView);

    // handle lighting values
    switch (model.lastLightComplexity) {
      default:
      case 0: // no lighting, tcolor is fine as is
        break;

      case 1: // headlight
      case 2: // light kit
      case 3: {
        // positional not implemented fallback to directional
        // mat3.transpose(keyMats.normalMatrix, keyMats.normalMatrix);
        let lightNum = 0;
        const lightColor = [];
        const normal = vec3.create();
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
    const program = cellBO.getProgram();
    program.setUniformi('jtexture', model.jitterTexture.getTextureUnit());

    actors.forEach((actor, volIdx) => {
      program.setUniformi(
        `ctexture${volIdx + 1}`,
        model.perVol[volIdx].colorTexture.getTextureUnit()
      );
      program.setUniformi(
        `otexture${volIdx + 1}`,
        model.perVol[volIdx].opacityTexture.getTextureUnit()
      );

      const volInfo = model.perVol[volIdx].scalarTexture.getVolumeInfo();
      const vprop = actor.getProperty();

      // set the component mix when independent
      const numComp = model.perVol[volIdx].scalarTexture.getComponents();
      const iComps = actor.getProperty().getIndependentComponents();
      if (iComps && numComp >= 2) {
        let totalComp = 0.0;
        for (let i = 0; i < numComp; ++i) {
          totalComp += actor.getProperty().getComponentWeight(i);
        }
        for (let i = 0; i < numComp; ++i) {
          program.setUniformf(
            `mix${i}_${volIdx}`,
            actor.getProperty().getComponentWeight(i) / totalComp
          );
        }
      }

      // three levels of shift scale combined into one
      // for performance in the fragment shader
      for (let i = 0; i < numComp; ++i) {
        const target = iComps ? i : 0;
        const sscale = volInfo.scale[i];
        const ofun = vprop.getScalarOpacity(target);
        const oRange = ofun.getRange();
        const oscale = sscale / (oRange[1] - oRange[0]);
        const oshift =
          (volInfo.offset[i] - oRange[0]) / (oRange[1] - oRange[0]);
        program.setUniformf(`oshift${i}_${volIdx}`, oshift);
        program.setUniformf(`oscale${i}_${volIdx}`, oscale);

        const cfun = vprop.getRGBTransferFunction(target);
        const cRange = cfun.getRange();
        program.setUniformf(
          `cshift${i}_${volIdx}`,
          (volInfo.offset[i] - cRange[0]) / (cRange[1] - cRange[0])
        );
        program.setUniformf(
          `cscale${i}_${volIdx}`,
          sscale / (cRange[1] - cRange[0])
        );
      }

      if (model.gopacity) {
        if (iComps) {
          for (let nc = 0; nc < numComp; ++nc) {
            const sscale = volInfo.scale[nc];
            const useGO = vprop.getUseGradientOpacity(nc);
            if (useGO) {
              const gomin = vprop.getGradientOpacityMinimumOpacity(nc);
              const gomax = vprop.getGradientOpacityMaximumOpacity(nc);
              program.setUniformf(`gomin${nc}_${volIdx}`, gomin);
              program.setUniformf(`gomax${nc}_${volIdx}`, gomax);
              const goRange = [
                vprop.getGradientOpacityMinimumValue(nc),
                vprop.getGradientOpacityMaximumValue(nc),
              ];
              program.setUniformf(
                `goscale${nc}_${volIdx}`,
                (sscale * (gomax - gomin)) / (goRange[1] - goRange[0])
              );
              program.setUniformf(
                `goshift${nc}_${volIdx}`,
                (-goRange[0] * (gomax - gomin)) / (goRange[1] - goRange[0]) +
                  gomin
              );
            } else {
              program.setUniformf(`gomin${nc}_${volIdx}`, 1.0);
              program.setUniformf(`gomax${nc}_${volIdx}`, 1.0);
              program.setUniformf(`goscale${nc}_${volIdx}`, 0.0);
              program.setUniformf(`goshift${nc}_${volIdx}`, 1.0);
            }
          }
        } else {
          const sscale = volInfo.scale[numComp - 1];
          const gomin = vprop.getGradientOpacityMinimumOpacity(0);
          const gomax = vprop.getGradientOpacityMaximumOpacity(0);
          program.setUniformf(`gomin0_${volIdx}`, gomin);
          program.setUniformf(`gomax0_${volIdx}`, gomax);
          const goRange = [
            vprop.getGradientOpacityMinimumValue(0),
            vprop.getGradientOpacityMaximumValue(0),
          ];
          program.setUniformf(
            `goscale_${volIdx}`,
            (sscale * (gomax - gomin)) / (goRange[1] - goRange[0])
          );
          program.setUniformf(
            `goshift0_${volIdx}`,
            (-goRange[0] * (gomax - gomin)) / (goRange[1] - goRange[0]) + gomin
          );
        }
      }

      if (model.lastLightComplexity > 0) {
        program.setUniformf(`vAmbient_${volIdx}`, vprop.getAmbient());
        program.setUniformf(`vDiffuse_${volIdx}`, vprop.getDiffuse());
        program.setUniformf(`vSpecular_${volIdx}`, vprop.getSpecular());
        program.setUniformf(
          `vSpecularPower_${volIdx}`,
          vprop.getSpecularPower()
        );
      }
    });
  };

  publicAPI.getRenderTargetSize = () => {
    if (model.lastXYF > 1.43) {
      const sz = model.framebuffer.getSize();
      return [model.fvp[0] * sz[0], model.fvp[1] * sz[1]];
    }
    return model.openGLRenderWindow.getFramebufferSize();
  };

  publicAPI.renderPieceStart = (ren, actors) => {
    const autoAdjust = false; // model.renderable.getAutoAdjustSampleDistances();
    if (autoAdjust) {
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
          (model.avgFrameTime * rwi.getDesiredUpdateRate()) /
            model.avgWindowArea
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
    } else {
      // model.lastXYF = model.renderable.getImageSampleDistance();
    }

    // only use FBO beyond this value
    if (model.lastXYF <= 1.43) {
      model.lastXYF = 1.0;
    }

    // console.log(`last target  ${model.lastXYF} ${model.targetXYF}`);
    // console.log(`awin aft  ${model.avgWindowArea} ${model.avgFrameTime}`);
    const xyf = model.lastXYF;

    const size = model.openGLRenderWindow.getFramebufferSize();
    // const newSize = [
    //   Math.floor((size[0] / xyf) + 0.5),
    //   Math.floor((size[1] / xyf) + 0.5)];

    // const diag = vtkBoundingBox.getDiagonalLength(model.currentInput.getBounds());

    // // so what is the resulting sample size roughly
    // console.log(`sam size ${diag / newSize[0]} ${diag / newSize[1]} ${model.renderable.getImageSampleDistance()}`);

    // // if the sample distance is getting far from the image sample dist
    // if (2.0 * diag / (newSize[0] + newSize[1]) > 4 * model.renderable.getSampleDistance()) {
    //   model.renderable.setSampleDistance(4.0 * model.renderable.getSampleDistance());
    // }
    // if (2.0 * diag / (newSize[0] + newSize[1]) < 0.25 * model.renderable.getSampleDistance()) {
    //   model.renderable.setSampleDistance(0.25 * model.renderable.getSampleDistance());
    // }

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

    // set interpolation on the texture based on property setting
    actors.forEach((actor, volIdx) => {
      const { scalarTexture } = model.perVol[volIdx];
      const iType = actor.getProperty().getInterpolationType();
      if (iType === InterpolationType.NEAREST) {
        scalarTexture.setMinificationFilter(Filter.NEAREST);
        scalarTexture.setMagnificationFilter(Filter.NEAREST);
      } else {
        scalarTexture.setMinificationFilter(Filter.LINEAR);
        scalarTexture.setMagnificationFilter(Filter.LINEAR);
      }
    });

    // Bind the OpenGL, this is shared between the different primitive/cell types.
    model.lastBoundBO = null;

    // if we have a zbuffer texture then activate it
    if (model.zBufferTexture !== null) {
      model.zBufferTexture.activate();
    }
  };

  publicAPI.renderPieceDraw = (ren, actors) => {
    const gl = model.context;

    // render the texture
    actors.forEach((actor, volIdx) => {
      model.perVol[volIdx].scalarTexture.activate();
      model.perVol[volIdx].opacityTexture.activate();
      model.perVol[volIdx].colorTexture.activate();
    });
    model.jitterTexture.activate();

    publicAPI.updateShaders(model.tris, ren, actors);

    // First we do the triangles, update the shader, set uniforms, etc.
    // for (let i = 0; i < 11; ++i) {
    //   gl.drawArrays(gl.TRIANGLES, 66 * i, 66);
    // }
    gl.drawArrays(gl.TRIANGLES, 0, model.tris.getCABO().getElementCount());
    model.tris.getVAO().release();

    actors.forEach((actor, volIdx) => {
      model.perVol[volIdx].scalarTexture.deactivate();
      model.perVol[volIdx].opacityTexture.deactivate();
      model.perVol[volIdx].colorTexture.deactivate();
    });
    model.jitterTexture.deactivate();
  };

  /* getProgramInfo(gl, program) {
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
  } */

  publicAPI.renderPieceFinish = (ren, actors) => {
    const actor = actors[0];
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

    /* const gl = model.context;
    const program = model.lastBoundBO.getProgram().getHandle();

    console.warn(getProgramInfo(gl, program));
    console.warn(JSON.stringify(getProgramInfo(gl, program), null, 2)); */
  };

  publicAPI.renderPiece = (ren, actors) => {
    if (!actors || !actors.length) {
      vtkErrorMacro('No input!');
      return;
    }

    const actor = actors[0];
    publicAPI.invokeEvent({ type: 'StartEvent' });
    // model.renderable.update();

    model.currentInput = actor.getMapper().getInputData();
    publicAPI.invokeEvent({ type: 'EndEvent' });

    if (!model.currentInput) {
      vtkErrorMacro('No input!');
      return;
    }

    publicAPI.renderPieceStart(ren, actors);
    publicAPI.renderPieceDraw(ren, actors);
    publicAPI.renderPieceFinish(ren, actors);
  };

  publicAPI.computeBounds = (ren, actors) => {
    const actor = actors[0];

    if (!publicAPI.getInput()) {
      vtkMath.uninitializeBounds(model.Bounds);
      return;
    }
    model.bounds = publicAPI.getInput().getBounds();
  };

  publicAPI.updateBufferObjects = (ren, actors) => {
    // Rebuild buffers if needed
    if (publicAPI.getNeedToRebuildBufferObjects(ren, actors)) {
      publicAPI.buildBufferObjects(ren, actors);
    }
  };

  publicAPI.getNeedToRebuildBufferObjects = (ren, actors) => {
    const actor = actors[0];

    // first do a coarse check
    if (
      model.VBOBuildTime.getMTime() < publicAPI.getMTime() ||
      model.VBOBuildTime.getMTime() < actor.getMTime() ||
      model.VBOBuildTime.getMTime() < model.renderable.getMTime() ||
      model.VBOBuildTime.getMTime() < actor.getProperty().getMTime() ||
      model.VBOBuildTime.getMTime() < model.currentInput.getMTime()
    ) {
      return true;
    }
    return false;
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

    console.log(combinedCTable);
    debugger;

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
    if (!actors || !actors.length) {
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

    const numVolumes = actors.length;

    let toString;

    actors.forEach((actor, volIdx) => {
      const image = actor.getMapper().getInputData();
      const numComp = image
        .getPointData()
        .getScalars()
        .getNumberOfComponents();
      const vprop = actor.getProperty();
      const volumeData = model.perVol[volIdx];

      const iComps = vprop.getIndependentComponents();
      const numIComps = iComps ? numComp : 1;
      // TODO[multivolume] Stupid question: If we modify these,
      //  are they modified in the object as well?
      let {
        scalarTextureMTime,
        colorTextureMTime,
        opacityTextureMTime,
      } = volumeData;

      const { scalarTexture, opacityTexture, colorTexture } = volumeData;

      // rebuild opacity tfun?
      if (opacityTextureMTime !== vprop.getMTime()) {
        const oWidth = 1024;
        const oSize = oWidth * 2 * numIComps;
        const ofTable = new Float32Array(oSize);
        const tmpTable = new Float32Array(oWidth);

        for (let c = 0; c < numIComps; ++c) {
          const ofun = vprop.getScalarOpacity(c);
          const opacityFactor = 1.0 / vprop.getScalarOpacityUnitDistance(c);

          const oRange = ofun.getRange();
          ofun.getTable(oRange[0], oRange[1], oWidth, tmpTable, 1);
          // adjust for sample distance etc
          for (let i = 0; i < oWidth; ++i) {
            ofTable[c * oWidth * 2 + i] =
              1.0 - (1.0 - tmpTable[i]) ** opacityFactor;
            ofTable[c * oWidth * 2 + i + oWidth] = ofTable[c * oWidth * 2 + i];
          }
        }

        opacityTexture.releaseGraphicsResources(model.openGLRenderWindow);
        opacityTexture.setMinificationFilter(Filter.LINEAR);
        opacityTexture.setMagnificationFilter(Filter.LINEAR);

        // use float texture where possible because we really need the resolution
        // for this table. Errors in low values of opacity accumulate to
        // visible artifacts. High values of opacity quickly terminate without
        // artifacts.
        if (
          model.openGLRenderWindow.getWebgl2() ||
          (model.context.getExtension('OES_texture_float') &&
            model.context.getExtension('OES_texture_float_linear'))
        ) {
          opacityTexture.create2DFromRaw(
            oWidth,
            2 * numIComps,
            1,
            VtkDataTypes.FLOAT,
            ofTable
          );
        } else {
          const oTable = new Uint8Array(oSize);
          for (let i = 0; i < oSize; ++i) {
            oTable[i] = 255.0 * ofTable[i];
          }
          opacityTexture.create2DFromRaw(
            oWidth,
            2 * numIComps,
            1,
            VtkDataTypes.UNSIGNED_CHAR,
            oTable
          );
        }

        opacityTextureMTime = vprop.getMTime();
      }

      if (colorTextureMTime !== vprop.getMTime()) {
        const cWidth = 1024;
        const cSize = cWidth * 2 * numIComps * 3;
        const cTable = new Uint8Array(cSize);
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

        colorTexture.releaseGraphicsResources(model.openGLRenderWindow);
        colorTexture.setMinificationFilter(Filter.LINEAR);
        colorTexture.setMagnificationFilter(Filter.LINEAR);

        colorTexture.create2DFromRaw(
          cWidth,
          2 * numIComps,
          3,
          VtkDataTypes.UNSIGNED_CHAR,
          cTable
        );

        colorTextureMTime = vprop.getMTime();
      }

      const sampleDist = 1; // model.renderable.getSampleDistance();

      // rebuild the scalarTexture if the data has changed
      if (scalarTextureMTime !== image.getMTime()) {
        // Build the textures
        const dims = image.getDimensions();
        scalarTexture.releaseGraphicsResources(model.openGLRenderWindow);
        scalarTexture.resetFormatAndType();
        scalarTexture.create3DFilterableFromRaw(
          dims[0],
          dims[1],
          dims[2],
          numComp,
          image
            .getPointData()
            .getScalars()
            .getDataType(),
          image
            .getPointData()
            .getScalars()
            .getData()
        );

        scalarTextureMTime = image.getMTime();
      }
    });

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

      // const dim = 12.0;
      // const ptsArray = new Float32Array(3 * dim * dim);
      // for (let i = 0; i < dim; i++) {
      //   for (let j = 0; j < dim; j++) {
      //     const offset = ((i * dim) + j) * 3;
      //     ptsArray[offset] = (2.0 * (i / (dim - 1.0))) - 1.0;
      //     ptsArray[offset + 1] = (2.0 * (j / (dim - 1.0))) - 1.0;
      //     ptsArray[offset + 2] = -1.0;
      //   }
      // }

      // const cellArray = new Uint16Array(8 * (dim - 1) * (dim - 1));
      // for (let i = 0; i < dim - 1; i++) {
      //   for (let j = 0; j < dim - 1; j++) {
      //     const offset = 8 * ((i * (dim - 1)) + j);
      //     cellArray[offset] = 3;
      //     cellArray[offset + 1] = (i * dim) + j;
      //     cellArray[offset + 2] = (i * dim) + 1 + j;
      //     cellArray[offset + 3] = ((i + 1) * dim) + 1 + j;
      //     cellArray[offset + 4] = 3;
      //     cellArray[offset + 5] = (i * dim) + j;
      //     cellArray[offset + 6] = ((i + 1) * dim) + 1 + j;
      //     cellArray[offset + 7] = ((i + 1) * dim) + j;
      //   }
      // }

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
  scalarTexture: null,
  scalarTextureString: null,
  opacityTexture: null,
  opacityTextureString: null,
  colorTexture: null,
  colorTextureString: null,
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
  idxToView: null,
  idxNormalMatrix: null,
  modelToView: null,
  displayToView: null,
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

  // Per actor
  model.perVol = [];

  model.tris = vtkHelper.newInstance();

  model.jitterTexture = vtkOpenGLTexture.newInstance();
  model.jitterTexture.setWrapS(Wrap.REPEAT);
  model.jitterTexture.setWrapT(Wrap.REPEAT);
  model.framebuffer = vtkOpenGLFramebuffer.newInstance();

  model.idxToView = mat4.create();
  model.idxNormalMatrix = mat3.create();
  model.modelToView = mat4.create();
  model.displayToView = mat4.create();
  model.displayToWorld = mat4.create();

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
