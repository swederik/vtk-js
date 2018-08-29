import vtkStateBuilder from 'vtk.js/Sources/Widgets/Core/StateBuilder';

export default function generateState() {
  return vtkStateBuilder
    .createBuilder()
    .addStateFromMixin({
      labels: ['start', 'handles'],
      mixins: ['origin', 'color', 'scale1'],
      name: 'start',
      initialValues: {
        scale1: 0.1,
        origin: [-1, -1, -1],
      },
    })
    .addStateFromMixin({
      labels: ['end', 'handles'],
      mixins: ['origin', 'color', 'scale1'],
      name: 'end',
      initialValues: {
        scale1: 0.1,
        origin: [1, 1, 1],
      },
    })
    .build();
}
