chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'toMarkdown',
    title: '复制为 Markdown',
    contexts: ['selection', 'page'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  chrome.tabs.sendMessage(tab.id, { action: 'convert' });
});
