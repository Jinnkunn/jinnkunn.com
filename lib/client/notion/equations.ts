export function initInlineEquationA11y(root: ParentNode) {
  const equations = Array.from(
    root.querySelectorAll<HTMLElement>(".notion-equation.notion-equation__inline"),
  );
  for (const equation of equations) {
    equation.tabIndex = 0;
  }
}
