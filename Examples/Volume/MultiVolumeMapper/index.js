import 'vtk.js/Sources/favicon';

import { vec3 } from 'gl-matrix';
import vtkFullScreenRenderWindow from 'vtk.js/Sources/Rendering/Misc/FullScreenRenderWindow';
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction';
import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction';
import vtkVolume from 'vtk.js/Sources/Rendering/Core/Volume';
import vtkVolumeMapper from 'vtk.js/Sources/Rendering/Core/VolumeMapper';
import vtkImageData from 'vtk.js/Sources/Common/DataModel/ImageData';
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray';

// ----------------------------------------------------------------------------
// Standard rendering code setup
// ----------------------------------------------------------------------------

const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
  background: [0.3, 0.3, 0.3],
});
const renderer = fullScreenRenderer.getRenderer();
const renderWindow = fullScreenRenderer.getRenderWindow();

function createCube() {
  const cubeArray = new Uint8Array(10 * 10 * 10);
  for (let i = 0; i < cubeArray.length; i++) {
    cubeArray.set([1], i);
  }

  const pointData = vtkDataArray.newInstance({
    name: 'Scalars',
    values: cubeArray,
    numberOfComponents: 1,
  });

  const imageData = vtkImageData.newInstance();
  imageData.getPointData().setScalars(pointData);
  imageData.setDimensions(10, 10, 10);

  const actor = vtkVolume.newInstance();
  const mapper = vtkVolumeMapper.newInstance();
  mapper.setSampleDistance(1);
  actor.setMapper(mapper);

  // create color and opacity transfer functions
  const ofun = vtkPiecewiseFunction.newInstance();
  ofun.addPoint(0, 0);
  ofun.addPoint(1, 0.5);

  const ctfun = vtkColorTransferFunction.newInstance();
  ctfun.addRGBPoint(0, 0, 0, 0);
  ctfun.addRGBPoint(1, 1, 0, 0);

  actor.getProperty().setRGBTransferFunction(0, ctfun);
  actor.getProperty().setScalarOpacity(0, ofun);
  // actor.getProperty().setScalarOpacityUnitDistance(0, 1.0);
  // actor.getProperty().setInterpolationTypeToLinear();
  // actor.getProperty().setShade(true);
  // actor.getProperty().setAmbient(0.1);
  // actor.getProperty().setDiffuse(0.9);
  // actor.getProperty().setSpecular(0.2);
  // actor.getProperty().setSpecularPower(10.0);

  mapper.setInputData(imageData);

  return {
    actor,
    mapper,
    imageData,
    ctfun,
    ofun,
  };
}

const objects = [];

const redCube = createCube();
const blueCube = createCube();
const greenCube = createCube();

blueCube.ctfun.addRGBPoint(1, 0, 0, 1);
blueCube.imageData.setOrigin(0.5, 0.5, 0);

greenCube.ctfun.addRGBPoint(1, 0, 1, 0);
greenCube.imageData.setOrigin(0.5, 0, 0);

objects.push(redCube, blueCube, greenCube);

renderer.addVolume(redCube.actor);
// renderer.addVolume(blueCube.actor);
// renderer.addVolume(greenCube.actor);

renderer.setUseMultiVolumeRendering(true);

renderer.resetCamera();
const dop = vec3.create();
vec3.set(dop, 0.5, 0.5, 0.5);
vec3.normalize(dop, dop);

renderer.getActiveCamera().setDirectionOfProjection(dop[0], dop[1], dop[2]);
renderer.getActiveCamera().setParallelProjection(true);
renderer.resetCamera();

renderWindow.render();

// -----------------------------------------------------------
// Make some variables global so that you can inspect and
// modify objects in your browser's developer console:
// -----------------------------------------------------------

global.objects = objects;
global.renderer = renderer;
global.renderWindow = renderWindow;
