// Localise the static text using chrome.i18n
const isJa = chrome.i18n.getUILanguage().startsWith('ja');
if (isJa) {
  document.documentElement.lang = 'ja';
  document.getElementById('heading').textContent = 'マイクへのアクセスを許可する';

  const bodyEl = document.getElementById('body');
  bodyEl.textContent = 'VoiceMarkets が音声検索を行うにはマイクが必要です。下のボタンをクリックして、ブラウザのプロンプトで「許可」を選んでください。';

  document.getElementById('grantBtn').textContent = 'マイクを許可する';
}

document.getElementById('grantBtn').addEventListener('click', async () => {
  const btn = document.getElementById('grantBtn');
  const msg = document.getElementById('msg');
  btn.disabled = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release the stream immediately — we only needed the permission grant
    stream.getTracks().forEach(t => t.stop());

    msg.className = 'msg ok';
    msg.textContent = isJa
      ? 'マイクが許可されました。このタブを閉じて、もう一度マイクボタンを押してください。'
      : 'Microphone access granted! Close this tab and click the mic button again.';
  } catch (err) {
    msg.className = 'msg error';
    if (err.name === 'NotAllowedError') {
      msg.textContent = isJa
        ? '許可されませんでした。Chrome の設定でマイクを許可してください。'
        : 'Permission denied. Please allow microphone access in Chrome settings.';
    } else {
      msg.textContent = isJa ? `エラー: ${err.message}` : `Error: ${err.message}`;
    }
    btn.disabled = false;
  }
});
