/* eslint no-debugger:0 no-console:0 */
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
import vtkMultiVolumeFS from 'vtk.js/Sources/Rendering/OpenGL/glsl/vtkMultiVolumeFS.glsl';

const { vtkWarningMacro, vtkErrorMacro } = macro;

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
    console.warn(`volumePass: prepass=${prepass}`);
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

      model.perVol.forEach((volData) => {
        volData.scalarTexture.setOpenGLRenderWindow(model.openGLRenderWindow);
      });
      model.colorTexture.setOpenGLRenderWindow(model.openGLRenderWindow);
      model.opacityTexture.setOpenGLRenderWindow(model.openGLRenderWindow);

      const actors = model.renderable.getVolumes();

      publicAPI.renderPiece(ren, actors);
    }
  };

  publicAPI.buildShaders = (shaders, ren, actors) => {
    publicAPI.getShaderTemplate(shaders, ren, actors);
    publicAPI.replaceShaderValues(shaders, ren, actors);
  };

  publicAPI.getShaderTemplate = (shaders, ren, actors) => {
    shaders.Vertex = vtkVolumeVS;
    shaders.Fragment = vtkMultiVolumeFS;
    shaders.Geometry = '';
  };

  publicAPI.replaceShaderValues = (shaders, ren, actors) => {
    console.warn('replaceShaderValues');
    let FSSource = shaders.Fragment;

    const numVolumes = actors.length;

    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      const actor = actors[volIdx];
      model.perVol[volIdx] = model.perVol[volIdx] || {};
      model.perVol[volIdx].scalarTexture = vtkOpenGLTexture.newInstance();
      const numComp = model.perVol[volIdx].scalarTexture.getComponents();

      // define some values in the shader
      const iType = actor.getProperty().getInterpolationType();
      model.perVol[volIdx].iType = iType;

      const iComps = actor.getProperty().getIndependentComponents();
      model.perVol[volIdx].iComps = iComps;

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

    FSSource = vtkShaderProgram.substitute(
      FSSource,
      '//VTK::NumVolumes',
      `#define vtkNumVolumes ${numVolumes}`
    ).result;

    shaders.Fragment = FSSource;
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
      cellBO.getShaderSourceTime().getMTime() < model.renderable.getMTime() ||
      cellBO.getShaderSourceTime().getMTime() < model.currentInput.getMTime()
    ) {
      model.lastZBufferTexture = model.zBufferTexture;
      return true;
    }

    return false;
  };

  publicAPI.updateShaders = (cellBO, ren, actors) => {
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

  publicAPI.setMapperShaderParameters = (cellBO, ren) => {
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

    model.perVol.forEach(({ scalarTexture }, i) => {
      program.setUniformi(`texture${i}`, scalarTexture.getTextureUnit());
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

  publicAPI.setCameraShaderParameters = (cellBO, ren, actors) => {
    // // [WMVD]C == {world, model, view, display} coordinates
    // // E.g., WCDC == world to display coordinate transformation
    const keyMats = model.openGLCamera.getKeyMatrices(ren);
    const actMats = model.openGLVolume.getKeyMatrices();

    mat4.multiply(model.modelToView, keyMats.wcvc, actMats.mcwc);

    const program = cellBO.getProgram();

    const cam = model.openGLCamera.getRenderable();
    const crange = cam.getClippingRange();
    program.setUniformf('camThick', crange[1] - crange[0]);
    program.setUniformf('camNear', crange[0]);
    program.setUniformf('camFar', crange[1]);

    // const bounds = model.currentInput.getBounds();
    const dims = model.currentInput.getDimensions();

    // compute the viewport bounds of the volume
    // we will only render those fragments.
    const pos = vec3.create();
    // const dir = vec3.create();

    // TODO[multivolume]: Update input to vertex shader to compute dcxmin
    // dcxmax, dcymin,dcymax from the combination of volumes
    const dcxmin = -1.0;
    const dcxmax = 1.0;
    const dcymin = -1.0;
    const dcymax = 1.0;

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

    const actor = actors[0];
    const ext = actor.getExtent();
    const spc = actor.getSpacing();
    const vsize = vec3.create();
    vec3.set(
      vsize,
      (ext[1] - ext[0] + 1) * spc[0],
      (ext[3] - ext[2] + 1) * spc[1],
      (ext[5] - ext[4] + 1) * spc[2]
    );
    program.setUniform3f('vSpacing', spc[0], spc[1], spc[2]);

    vec3.set(pos, ext[0], ext[2], ext[4]);
    model.currentInput.indexToWorldVec3(pos, pos);

    vec3.transformMat4(pos, pos, model.modelToView);
    program.setUniform3f('vOriginVC', pos[0], pos[1], pos[2]);

    // apply the volume directions
    const i2wmat4 = actor.getIndexToWorld();
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

    const maxSamples = vec3.length(vsize) / 1;
    if (maxSamples > model.renderable.getMaximumSamplesPerRay()) {
      vtkWarningMacro(`The number of steps required ${Math.ceil(
        maxSamples
      )} is larger than the
        specified maximum number of steps ${model.renderable.getMaximumSamplesPerRay()}.
        Please either change the
        volumeMapper sampleDistance or its maximum number of samples.`);
    }

    const vctoijk = vec3.create();

    vec3.set(vctoijk, 1.0, 1.0, 1.0);
    vec3.divide(vctoijk, vctoijk, vsize);
    program.setUniform3f('vVCToIJK', vctoijk[0], vctoijk[1], vctoijk[2]);
    program.setUniform3i('volumeDimensions', dims[0], dims[1], dims[2]);

    if (!model.openGLRenderWindow.getWebgl2()) {
      const volInfo = model.perVol[0].scalarTexture.getVolumeInfo();
      program.setUniformf('texWidth', model.perVol[0].scalarTexture.getWidth());
      program.setUniformf(
        'texHeight',
        model.perVol[0].scalarTexture.getHeight()
      );
      program.setUniformi('xreps', volInfo.xreps);
      program.setUniformf('xstride', volInfo.xstride);
      program.setUniformf('ystride', volInfo.ystride);
    }

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
      program.setUniform3f(`vPlaneNormal${i}`, normal[0], normal[1], normal[2]);
      program.setUniformf(`vPlaneDistance${i}`, dist);
    }

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

    program.setUniformi('ctexture', model.colorTexture.getTextureUnit());
    program.setUniformi('otexture', model.opacityTexture.getTextureUnit());
    program.setUniformi('jtexture', model.jitterTexture.getTextureUnit());

    const perVol = [];
    const numVolumes = actors.length;

    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      // Create an object to store the per-component values for later
      // We call setUniform later on with this information
      const actor = actors[volIdx];
      const vprop = actor.getProperty();
      const volInfo = model.perVol[volIdx].scalarTexture.getVolumeInfo();

      // set the component mix when independent
      const iComps = actor.getProperty().getIndependentComponents();
      const numComp = model.perVol[volIdx].scalarTexture.getComponents();

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

      /*
      TODO[multivolume]: Temporarily disable gradient opacity
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
      } */

      if (model.lastLightComplexity > 0) {
        volumeData.ambient = vprop.getAmbient();
        volumeData.diffuse = vprop.getDiffuse();
        volumeData.specular = vprop.getSpecular();
        volumeData.specularPower = vprop.getSpecularPower();
      }

      perVol.push(volumeData);
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
        console.warn(`${key}${i}`, value);
      });
    }

    program.setUniformf('vAmbient', perVol.map((v) => v.ambient));
    program.setUniformf('vDiffuse', perVol.map((v) => v.diffuse));
    program.setUniformf('vSpecular', perVol.map((v) => v.specular));
    program.setUniformf('vSpecularPower', perVol.map((v) => v.specularPower));
    program.setUniformi('numComps', numComps);
  };

  publicAPI.getRenderTargetSize = () => {
    if (model.lastXYF > 1.43) {
      const sz = model.framebuffer.getSize();
      return [model.fvp[0] * sz[0], model.fvp[1] * sz[1]];
    }
    return model.openGLRenderWindow.getFramebufferSize();
  };

  publicAPI.renderPieceStart = (ren, actors) => {
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

    // set interpolation on the texture based on property setting
    // TODO[multivolume]: Set these per volume

    const numVolumes = model.volumes.length;
    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      const actor = actors[volIdx];
      const iType = actor.getProperty().getInterpolationType();
      const scalarTexture = model.perVol[volIdx].scalarTexture;
      if (iType === InterpolationType.NEAREST) {
        scalarTexture.setMinificationFilter(Filter.NEAREST);
        scalarTexture.setMagnificationFilter(Filter.NEAREST);
      } else {
        scalarTexture.setMinificationFilter(Filter.LINEAR);
        scalarTexture.setMagnificationFilter(Filter.LINEAR);
      }
    }

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
    model.perVol.forEach((volData) => {
      volData.scalarTexture.activate();
    });

    model.opacityTexture.activate();
    model.colorTexture.activate();
    model.jitterTexture.activate();

    publicAPI.updateShaders(model.tris, ren, actors);

    // First we do the triangles, update the shader, set uniforms, etc.
    gl.drawArrays(gl.TRIANGLES, 0, model.tris.getCABO().getElementCount());
    model.tris.getVAO().release();

    model.perVol.forEach((volData) => {
      volData.scalarTexture.deactivate();
    });
    model.colorTexture.deactivate();
    model.opacityTexture.deactivate();
    model.jitterTexture.deactivate();
  };

  publicAPI.renderPieceFinish = (ren, actors) => {
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
    if (!actors || !actors.length) {
      vtkErrorMacro('No input!');
      return;
    }

    publicAPI.renderPieceStart(ren, actors);
    publicAPI.renderPieceDraw(ren, actors);
    publicAPI.renderPieceFinish(ren, actors);
  };

  publicAPI.computeBounds = (ren, actors) => {
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
    const actorMTimes = actors.map((a) => a.getMTime());
    const actorPropertyMTimes = actors.map((a) => a.getProperty().getMTime());
    const latestActorPropertyMTime = Math.max(...actorPropertyMTimes);
    const latestActorMTime = Math.max(...actorMTimes);

    // first do a coarse check
    if (
      model.VBOBuildTime.getMTime() < publicAPI.getMTime() ||
      model.VBOBuildTime.getMTime() < latestActorMTime() ||
      model.VBOBuildTime.getMTime() < model.renderable.getMTime() ||
      model.VBOBuildTime.getMTime() < latestActorPropertyMTime
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
      const ofTable = new Float32Array(combinedOTableFloat, offset, oSizeMax);
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
      const cTable = new Uint8Array(
        combinedCTable.arrayBufffer,
        offset,
        cSizeMax
      );
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
    if (!!actors.length === null) {
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

    const numVolumes = model.volumes.length;
    const needToRebuildTexture = {
      opacity: false,
      color: false,
    };
    for (let volIdx = 0; volIdx < numVolumes; volIdx++) {
      const volumeData = model.perVol[volIdx] || {};
      const actor = model.volumes[volIdx];
      const imageData = actor.getMapper().getInputData();
      const dims = imageData.getDimensions();
      const numComp = imageData
        .getPointData()
        .getScalars()
        .getNumberOfComponents();

      // TODO[multivolume] Stupid question: If we modify these,
      //  are they modified in the object as well?
      let { scalarTextureMTime } = volumeData;
      const {
        scalarTexture,
        opacityTextureMTime,
        colorTextureMTime,
      } = volumeData;

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
      debugger;
      if (
        !scalarTexture ||
        (scalarTextureMTime !== imageData.getMTime() &&
          !needToRebuildTexture.scalar)
      ) {
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

  model.tris = vtkHelper.newInstance();

  // Per actor
  model.perVol = [];
  model.idxToView = []; // Array of mat4
  model.idxNormalMatrix = []; // Array mat3
  model.modelToView = []; // Array of mat4
  model.displayToView = []; // Array of mat4
  model.displayToWorld = []; // Array of mat4

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
