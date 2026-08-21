const turndownService = new TurndownService({ headingStyle: 'atx' });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'convert') {
    return;
  }

  // 有选中就转选中,没选中就转正文
  const selection = window.getSelection();
  let html;
  if (selection.rangeCount && !selection.isCollapsed) {
    const div = document.createElement('div');
    div.appendChild(selection.getRangeAt(0).cloneContents());
    html = div.innerHTML;
  } else {
    html = document.body.innerHTML;
  }

  const markdown = turndownService.turndown(html);
  navigator.clipboard.writeText(markdown); // 直接进剪贴板,不上传
});
