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

function vtkSVGDistanceWidget(publicAPI, model) {
  model.classHierarchy.push('vtkSVGDistanceWidget');
  model.widgetId = `vtkSVGDistanceWidget-${instanceId++}`;

  publicAPI.render = (svgContainer, scale) => {
    const node = getWidgetNode(svgContainer, model.widgetId);
    const {
      fontFamily,
      fontSize,
      fontWeight,
      labelPosition,
      point1,
      point2,
      strokeColor,
      text,
      textColor,
    } = model;
    const center = [
      (point1[0] + point2[0]) * 0.5,
      (point1[1] + point2[1]) * 0.5,
    ];
    node.innerHTML = `
<g id="container" fill-opacity="1" stroke-dasharray="none" stroke="none" stroke-opacity="1" fill="none">
 <g>
  <line
    x1="${point1[0] * scale}"
    y1="${point1[1] * scale}"
    x2="${point2[0] * scale}"
    y2="${point2[1] * scale}"
    stroke="${strokeColor}"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="4"
  ></line>
  <line
    x1="${center[0] * scale}"
    y1="${center[1] * scale}"
    x2="${labelPosition[0] * scale}"
    y2="${labelPosition[1] * scale}"
    stroke-dasharray="8.0,5.0"
    stroke="${strokeColor}"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="4"
  ></line>
  <text
    transform="translate(${center.map((i) => i * scale).join(' ')})"
    fill="${textColor}"
    font-family="${fontFamily}"
    font-size="${fontSize}"
    font-weight="${fontWeight}"
  >
    <tspan
      class="draggable"
      data-id="${model.widgetId}"
      data-field="labelPosition"
      x="0"
      y="0"
    >${text}</tspan>
  </text>
 </g>
</g>
      `;
  };
}

// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  text: 'Some text',
  labelPosition: [30, 10],
  point1: [20, 20],
  point2: [40, 20],
  strokeColor: '#979797',
  textColor: '#979797',
  fontFamily: 'HelveticaNeue, Helvetica Neue',
  fontSize: 12,
  fontWeight: 'normal',
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  macro.obj(publicAPI, model);
  macro.get(publicAPI, model, ['widgetId']);
  macro.setGet(publicAPI, model, [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'strokeColor',
    'text',
    'textColor',
  ]);
  macro.setGetArray(publicAPI, model, ['labelPosition', 'point1', 'point2'], 2);

  vtkSVGDistanceWidget(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkSVGDistanceWidget');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
