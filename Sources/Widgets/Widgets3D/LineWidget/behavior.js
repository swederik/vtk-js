import macro from 'vtk.js/Sources/macro';
import vtkMath from 'vtk.js/Sources/Common/Core/Math';

export default function widgetBehavior(publicAPI, model) {
  model.classHierarchy.push('vtkLineWidgetProp');
  let isDragging = null;

  // --------------------------------------------------------------------------
  // Display 2D
  // --------------------------------------------------------------------------

  function displayCallbackWrapper(coords2D) {
    const startPoint3D = model.widgetState.getStart().getOrigin();
    const endPoint3D = model.widgetState.getEnd().getOrigin();
    const startPoint2D = coords2D[0].slice(0, 2).map(Math.round);
    const endPoint2D = coords2D[1].slice(0, 2).map(Math.round);
    const center = [
      0.5 * (startPoint2D[0] + endPoint2D[0]),
      0.5 * (startPoint2D[1] + endPoint2D[1]),
    ];
    const distance = Math.sqrt(
      vtkMath.distance2BetweenPoints(startPoint3D, endPoint3D)
    );
    model.displayCallback({
      startPoint3D,
      endPoint3D,
      distance,
      center,
      startPoint2D,
      endPoint2D,
    });
  }

  publicAPI.set2DCallback = (callback) => {
    model.displayCallback = callback;
    model.representations[1].setDisplayCallback(
      callback ? displayCallbackWrapper : null
    );
  };
  // --------------------------------------------------------------------------
  // Interactor events
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Left press: Select handle to drag
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonPress = (e) => {
    if (
      !model.activeState ||
      !model.activeState.getActive() ||
      !model.pickable
    ) {
      return macro.VOID;
    }

    isDragging = true;
    model.openGLRenderWindow.setCursor('grabbing');
    model.interactor.requestAnimation(publicAPI);

    publicAPI.invokeStartInteractionEvent();
    return macro.EVENT_ABORT;
  };

  // --------------------------------------------------------------------------
  // Mouse move: Drag selected handle / Handle follow the mouse
  // --------------------------------------------------------------------------

  publicAPI.handleMouseMove = (callData) => {
    if (
      model.pickable &&
      model.manipulator &&
      model.activeState &&
      model.activeState.getActive()
    ) {
      model.manipulator.setOrigin(model.activeState.getOrigin());
      model.manipulator.setNormal(model.camera.getDirectionOfProjection());
      const worldCoords = model.manipulator.handleEvent(
        callData,
        model.openGLRenderWindow
      );

      if (isDragging) {
        model.activeState.setOrigin(worldCoords);
        publicAPI.invokeInteractionEvent();
        return macro.EVENT_ABORT;
      }
    }

    return macro.VOID;
  };

  // --------------------------------------------------------------------------
  // Left release: Finish drag / Create new handle
  // --------------------------------------------------------------------------

  publicAPI.handleLeftButtonRelease = () => {
    if (isDragging && model.pickable) {
      model.openGLRenderWindow.setCursor('pointer');
      model.widgetState.deactivate();
      model.interactor.cancelAnimation(publicAPI);
      publicAPI.invokeEndInteractionEvent();
    }

    if (model.activeState && !model.activeState.getActive()) {
      publicAPI.invokeEndInteractionEvent();
      model.widgetManager.enablePicking();
      model.interactor.render();
    }

    isDragging = false;
  };
}
