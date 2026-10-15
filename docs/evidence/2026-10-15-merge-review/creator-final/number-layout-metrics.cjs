module.exports = function numberLayoutMetrics(row) {
  const input = row.querySelector('input[type=number]'), controls = row.querySelector('.creator-control');
  const style = getComputedStyle(input), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  context.font = style.font;
  const contentWidth = input.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
  const textWidth = context.measureText(input.value).width;
  const nodes = [
    ['range', row.querySelector('input[type=range]')], ['number', input], ['unit', row.querySelector('.creator-unit')],
    ['random', row.querySelector(':scope>button:not(.creator-lock)')], ['lock', row.querySelector('.creator-lock')],
  ];
  const overlaps = [], uncontained = [], clippedLabels = [];
  const inside = (inner, outer) => inner.left >= outer.left - .5 && inner.right <= outer.right + .5 && inner.top >= outer.top - .5 && inner.bottom <= outer.bottom + .5;
  for (let index = 0; index < nodes.length; index++) {
    const [name, node] = nodes[index], rect = node.getBoundingClientRect();
    if (index >= 3 && node.scrollWidth > node.clientWidth + 1) clippedLabels.push(name);
    const parent = index < 3 ? controls : row;
    if (!inside(rect, parent.getBoundingClientRect())) uncontained.push(name);
    for (let other = index + 1; other < nodes.length; other++) {
      const next = nodes[other][1].getBoundingClientRect();
      if (Math.min(rect.right, next.right) - Math.max(rect.left, next.left) > .5 && Math.min(rect.bottom, next.bottom) - Math.max(rect.top, next.top) > .5) overlaps.push([name, nodes[other][0]]);
    }
  }
  const editor = row.closest('.creator-editor'), content = row.closest('.creator-content');
  const editorRect = editor.getBoundingClientRect(), rowRect = row.getBoundingClientRect();
  return { width: innerWidth, value: input.value, inputWidth: input.getBoundingClientRect().width, textWidth, contentWidth,
    fits: textWidth + 16 <= contentWidth, controlOverflow: controls.scrollWidth > controls.clientWidth + 1,
    documentOverflow: document.documentElement.scrollWidth > innerWidth, editorOverflow: rowRect.left < editorRect.left - .5 || rowRect.right > editorRect.left + editor.clientLeft + editor.clientWidth + .5,
    overlaps, uncontained, clippedLabels, editorScrollOverflow: editor.scrollWidth > editor.clientWidth + 1, lockText: row.querySelector('.creator-lock').textContent,
    contentScrollbar: content.offsetWidth - content.clientWidth, editorScrollbar: editor.offsetWidth - editor.clientWidth };
};
