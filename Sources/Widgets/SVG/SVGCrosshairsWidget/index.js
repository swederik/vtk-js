import macro from 'vtk.js/Sources/macro';

let instanceId = 1;

function getWidgetNode(svgContainer, widgetId) {
  let node = svgContainer.querySelector(`#${widgetId}`);
  if (!node) {
    node = document.createElement('g');
    node.setAttribute('id', widgetId);
    svgContainer.appendChild(node);
  }
  return node;
}

// ----------------------------------------------------------------------------

function vtkSVGCrosshairsWidget(publicAPI, model) {
  model.classHierarchy.push('vtkSVGCrosshairsWidget');
  model.widgetId = `vtkSVGCrosshairsWidget-${instanceId++}`;

  publicAPI.render = (svgContainer, scale) => {
    const node = getWidgetNode(svgContainer, model.widgetId);
    const { point, strokeColor, strokeWidth, strokeDashArray, padding } = model;

    // TODO: Get renderWindow dimensions
    const width = 1000;
    const height = 1000;

    const left = [0, height / 2];
    const top = [width / 2, 0];
    const right = [width, height / 2];
    const bottom = [width / 2, height];
    node.innerHTML = `
<g id="container" fill-opacity="1" stroke-dasharray="none" stroke="none" stroke-opacity="1" fill="none">
 <g>
 <svg version="1.1" width="100%" height="100%">
 <!-- Top !-->
  <line
    x1="${point[0] * scale}"
    y1="${top[1] * scale}"
    x2="${point[0] * scale}"
    y2="${point[1] * scale - padding}"
    stroke="${strokeColor}"
    stroke-dasharray="${strokeDashArray}"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="${strokeWidth}"
  ></line>
  <!-- Right !-->
  <line
    x1="${right[0] * scale}"
    y1="${point[1] * scale}"
    x2="${point[0] * scale + padding}"
    y2="${point[1] * scale}"
    stroke-dasharray="${strokeDashArray}"
    stroke="${strokeColor}"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width=${strokeWidth}
  ></line>
  <!-- Bottom !-->
  <line
    x1="${point[0] * scale}"
    y1="${bottom[1] * scale}"
    x2="${point[0] * scale}"
    y2="${point[1] * scale + padding}"
    stroke-dasharray="${strokeDashArray}"
    stroke="${strokeColor}"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width=${strokeWidth}
  ></line>
  <!-- Left !-->
  <line
    x1="${left[0] * scale}"
    y1="${point[1] * scale}"
    x2="${point[0] * scale - padding}"
    y2="${point[1] * scale}"
    stroke-dasharray="${strokeDashArray}"
    stroke="${strokeColor}"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width=${strokeWidth}
  ></line>
 </g>
</g>
      `;
  };
}

// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  point: [20, 20],
  strokeColor: '#00ff00',
  strokeWidth: 1,
  strokeDashArray: '',
  padding: 20,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  macro.obj(publicAPI, model);
  macro.get(publicAPI, model, ['widgetId']);
  macro.setGet(publicAPI, model, [
    'strokeColor',
    'strokeWidth',
    'strokeDashArray',
  ]);
  macro.setGetArray(publicAPI, model, ['point', 'padding'], 2);

  vtkSVGCrosshairsWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkSVGCrosshairsWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
