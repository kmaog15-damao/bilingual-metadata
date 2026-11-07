/* The document signals readiness from its own window, after its controls exist. */
window.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  document.getElementById('cancel').addEventListener('click', () => window.close());
  try {
    const request = window.arguments?.[0];
    if (!request || typeof request.onReady !== 'function') throw Error('未收到文献处理请求，请关闭后重新打开。');
    status.textContent = '窗口已就绪，正在准备扫描…';
    request.onReady(window);
  } catch (e) {
    status.textContent = '初始化失败：' + e.message;
  }
}, {once:true});
