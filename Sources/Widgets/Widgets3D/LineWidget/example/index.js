import 'vtk.js/Sources/favicon';

import vtkFullScreenRenderWindow from 'vtk.js/Sources/Rendering/Misc/FullScreenRenderWindow';
import vtkLineWidget from 'vtk.js/Sources/Widgets/Widgets3D/LineWidget';
import vtkWidgetManager from 'vtk.js/Sources/Widgets/Core/WidgetManager';

import vtkSVGWidgetManager from 'vtk.js/Sources/Widgets/SVG/SVGWidgetManager';
import vtkSVGDistanceWidget from 'vtk.js/Sources/Widgets/SVG/SVGDistanceWidget';

import vtkActor from 'vtk.js/Sources/Rendering/Core/Actor';
import vtkConeSource from 'vtk.js/Sources/Filters/Sources/ConeSource';
import vtkMapper from 'vtk.js/Sources/Rendering/Core/Mapper';

// ----------------------------------------------------------------------------
// Standard rendering code setup
// ----------------------------------------------------------------------------

const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
  background: [0.5, 0.5, 0.5],
});
const renderer = fullScreenRenderer.getRenderer();

// ----------------------------------------------------------------------------
// Add context to place widget
// ----------------------------------------------------------------------------

const cone = vtkConeSource.newInstance();
const mapper = vtkMapper.newInstance();
const actor = vtkActor.newInstance({ pickable: false });

actor.setMapper(mapper);
mapper.setInputConnection(cone.getOutputPort());
actor.getProperty().setOpacity(0.5);
renderer.addActor(actor);

// ----------------------------------------------------------------------------
// Widget manager
// ----------------------------------------------------------------------------

const widgetManager = vtkWidgetManager.newInstance();
widgetManager.setRenderer(renderer);

const widget = vtkLineWidget.newInstance();
widget.placeWidget(cone.getOutputData().getBounds());
widget.setPlaceFactor(2);

const widgetProp = widgetManager.addWidget(widget);

renderer.resetCamera();
widgetManager.enablePicking();

// ----------------------------------------------------------------------------
// 2D / SVG overlay
// ----------------------------------------------------------------------------

const svgWidgetManager = vtkSVGWidgetManager.newInstance();
svgWidgetManager.setRenderer(renderer);

const distWidget = vtkSVGDistanceWidget.newInstance();

svgWidgetManager.addWidget(distWidget);
svgWidgetManager.render();

// ----------------------------------------------------------------------------
// Link 3D to 2D
// ----------------------------------------------------------------------------

widgetProp.set2DCallback(({ startPoint2D, endPoint2D, distance }) => {
  distWidget.setPoint1(startPoint2D);
  distWidget.setPoint2(endPoint2D);
  distWidget.setText(distance.toFixed(2));
  svgWidgetManager.render();
});
