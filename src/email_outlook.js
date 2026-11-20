const tls = require('tls');
const { simpleParser } = require('mailparser');

async function waitForOutlookXCode(email, password, timeoutSec = 55) {
  const startTime = Date.now();
  const timeoutMs = timeoutSec * 1000;
  const imapHost = 'outlook.office365.com';
  const imapPort = 993;

  console.log(`  ⏳ Outlook IMAP (${email}) でXからの6桁確認コードを待機中...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const code = await new Promise((resolve, reject) => {
        const socket = tls.connect({ host: imapHost, port: imapPort, rejectUnauthorized: false }, () => {});
        let buffer = '';
        let tagCount = 0;

        function sendCmd(cmd) {
          tagCount++;
          socket.write(`a${tagCount} ${cmd}\r\n`);
        }

        socket.on('data', (data) => {
          buffer += data.toString('utf8');
          if (buffer.includes('OK Success') || buffer.includes('OK LOGIN')) {
            if (tagCount === 1) sendCmd(`SELECT INBOX`);
            else if (tagCount === 2) sendCmd(`SEARCH UNSEEN SUBJECT "Twitter" SUBJECT "X" SUBJECT "確認"`);
            else if (tagCount === 3) {
              const m = buffer.match(/SEARCH\s+([0-9\s]+)/i);
              if (m && m[1].trim()) {
                const seqs = m[1].trim().split(/\s+/).pop();
                sendCmd(`FETCH ${seqs} BODY[TEXT]`);
              } else {
                sendCmd(`LOGOUT`);
                socket.end();
                resolve(null);
              }
            } else if (tagCount >= 4) {
              const codeMatch = buffer.match(/\b([0-9]{6})\b/);
              sendCmd(`LOGOUT`);
              socket.end();
              resolve(codeMatch ? codeMatch[1] : null);
            }
          } else if (buffer.includes('BYE') || buffer.includes('NO [AUTHENTICATIONFAILED]')) {
            socket.end();
            reject(new Error('IMAP認証失敗'));
          }
        });

        socket.on('connect', () => {
          sendCmd(`LOGIN "${email}" "${password}"`);
        });

        socket.on('error', (err) => reject(err));
        setTimeout(() => { socket.destroy(); resolve(null); }, 15000);
      });

      if (code && /^\d{6}$/.test(code)) {
        return code;
      }
    } catch (e) {}

    await new Promise(r => setTimeout(r, 5000));
  }
  return null;
}

module.exports = { waitForOutlookXCode };
