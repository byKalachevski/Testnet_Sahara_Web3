const puppeteer = require('puppeteer-core');
const {
  unlockRabby,
  selectNetwork,
  confirmRabbyTransaction,
  handleError112,
  handleError429
} = require('../core/helpers/walletHelper');

const _origExit = process.exit;
process.exit = (code = 0) => {
  setTimeout(() => _origExit(code), 5000);
};

const fs = require('fs');
const path = require('path');
const { sendLogShort } = require('../core/telegramLogger');


// --------------------------------------------
//            Загрузка профилей
// --------------------------------------------
function loadProfiles() {
  let profilesPath = process.env.PROFILES_PATH
    ? path.resolve(process.cwd(), process.env.PROFILES_PATH)
    : path.resolve(__dirname, 'profiles.json');

  if (!fs.existsSync(profilesPath)) {
    console.error(`❌ Профили не найдены: ${profilesPath}`);
    process.exit(1);
  }
  let raw = fs.readFileSync(profilesPath, 'utf-8');
  let profiles = JSON.parse(raw);
  if (!Array.isArray(profiles)) {
    console.error(`❌ Ожидается массив в ${profilesPath}`);
    process.exit(1);
  }
  for (const p of profiles) {
    if (
      typeof p.name !== 'string' ||
      typeof p.port !== 'number' ||
      typeof p.wsEndpoint !== 'string' ||
      typeof p.address !== 'string'
    ) {
      console.error(`❌ Некорректный профиль: ${JSON.stringify(p)}`);
      process.exit(1);
    }
    if (p.proxyAuth) {
      if (
        typeof p.proxyAuth.username !== 'string' ||
        typeof p.proxyAuth.password !== 'string'
      ) {
        console.error(`❌ Некорректный proxyAuth в профиле "${p.name}"`);
        process.exit(1);
      }
    }
  }
  console.log(`ℹ️ Загружено ${profiles.length} профилей`);
  return profiles;
}

const profiles = loadProfiles();

// --------------------------------------------
//              Утилиты
// --------------------------------------------
const delay = ms => new Promise(res => setTimeout(res, ms));
async function delayBeforeAction(ms = 2000) { await delay(ms); }
function log(name, ...args) { console.log(`[${name}]`, ...args); }

async function waitForAndClick(page, selector, name, message) {
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await page.click(selector);
  log(name, message);
  await delayBeforeAction();
}

async function connectWithTimeout(options, timeout = 10000) {
  return Promise.race([
    puppeteer.connect(options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TimeoutError: порт не отвечает')), timeout)
    ),
  ]);
}

// --------------------------------------------
//         Основная логика по профилю
// --------------------------------------------
async function runProfile(profile, index) {
  const { name, port, wsEndpoint, proxyAuth, address } = profile;
  const scriptName = process.env.CURRENT_SCRIPT || 'Magicnewton.js';
  await sendLogShort(`🚀 ${scriptName}: старт ${name}`);


  let browser;
  try {
    // подключаемся к Chrome
    const wsUrl = `ws://127.0.0.1:${port}${wsEndpoint}`;
    browser = await connectWithTimeout(
      { browserWSEndpoint: wsUrl, defaultViewport: null },
      10000
    );

    // proxyAuth
    const page = await browser.newPage();
    if (proxyAuth) {
      await page.authenticate(proxyAuth);
      log(name, `🔑 HTTP-Auth для proxy установлен`);
    }
    await delayBeforeAction();

    // проверка WS
    await page.goto('about:blank');
    await page.close();
    log(name, '✅ WS OK');
    await delayBeforeAction();

    // 7) Переход на Sahara и Sign In
    const newTab1 = await browser.newPage();
    await newTab1.setViewport({ width: 1920, height: 1080 });

    for (let attempt = 1; attempt <= 2; attempt++) {
      await newTab1.goto('https://legends.saharalabs.ai/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });
      log(name, `🌐 Sahara открыт (попытка ${attempt})`);
      await delayBeforeAction(2000);

      const found = await newTab1.evaluate(() =>
        [...document.querySelectorAll('span')].some(el =>
          el.textContent.trim().startsWith('Sign In')
        )
      );
      if (found) break;
      if (attempt === 2) {
        log(name, '❌ Кнопка "Sign In" не найдена после 2 попыток');
        return;
      }
      log(name, '🔁 Кнопка не найдена, пробуем перезагрузить...');
    }

    await newTab1.evaluate(() => {
      [...document.querySelectorAll('span')]
        .find(el => el.textContent.trim().startsWith('Sign In'))
        .closest('a')
        .click();
    });
    log(name, '🔐 Нажат «Sign In»');
    await delayBeforeAction(3000);


  // 1) Кликаем по «Rabby Wallet» из модалки подключения
  await newTab1.evaluate(() => {
    [...document.querySelectorAll(
      'div.h-12.px-6.flex.justify-between.items-center.border.rounded-full.cursor-pointer'
    )]
      .find(card =>
        card.querySelector('div.font-bold.text-base')?.textContent.trim() === 'Rabby Wallet'
      )
      ?.click();
  });
  await delayBeforeAction(2000);

    // 3) Разблокировка и подключение через ваш хелпер
  await unlockRabby(browser, {
    password: process.env.RABBY_PASSWORD,
    timeout: 5000,
    log: msg => console.log(`[${profile.name}] ${msg}`)
  });
  await delayBeforeAction(2000);

  // Подписание и подтверждение транзакции
  await confirmRabbyTransaction(browser, {
    timeout: 30000,                            // ждать до 30 секунд
    log: msg => console.log(`[${profile.name}] ${msg}`)
  });
  await delayBeforeAction(2000);

  try {
  await newTab1.close();
  log(name, '❎ Вкладка Sahara закрыта');
} catch (e) {
  log(name, `⚠️ Ошибка при закрытии вкладки Sahara: ${e.message}`);
}
await delayBeforeAction(2000);




  // 0) Открываем Rabby
  let extPage = await browser.newPage();
  const extensionURL =
    'chrome-extension://acmacodkjbdgmoleebolmdjonilkdbch/index.html#/send-token?rbisource=dashboard';
  await extPage.goto(extensionURL, { waitUntil: 'domcontentloaded', timeout: 200000 });
  log(name, '🌐 Rabby открыт');
  await delayBeforeAction(2500);


// 1a) Обновляем страницу на свежую после разблокировки
await extPage.reload({ waitUntil: 'domcontentloaded' });
await delayBeforeAction();


// 2) Выбор сети
await selectNetwork(extPage, 'SaharaAI Testnet', {
  timeout: 5000,
  log: msg => console.log(`[${name}] ${msg}`)
});
await delayBeforeAction();

// 3) Ввод адреса и суммы + «Отправить»
const toSel = 'textarea#to';
const amtSel = 'input[placeholder="0"]';

// 1) Ждём появления полей
await extPage.waitForSelector(toSel, { visible: true, timeout: 5000 });
await extPage.waitForSelector(amtSel, { visible: true, timeout: 5000 });

// 2) Генерируем случайную сумму
const min = 0.00061;
const max = 0.0095;
const randomAmount = (Math.random() * (max - min) + min).toFixed(6);

// === Ввод адреса «как человек» ===
await extPage.click(toSel);                                
await extPage.keyboard.down('Control');                    
await extPage.keyboard.press('KeyA');
await extPage.keyboard.up('Control');
await extPage.keyboard.press('Backspace');                  
await extPage.type(toSel, address, { delay: 100 });         
// триггерим события и снимаем фокус
await extPage.evaluate(selector => {
  const el = document.querySelector(selector);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
}, toSel);
await delayBeforeAction();                                   

// === Ввод суммы ===
await extPage.click(amtSel);
await extPage.keyboard.down('Control');
await extPage.keyboard.press('KeyA');
await extPage.keyboard.up('Control');
await extPage.keyboard.press('Backspace');
await extPage.type(amtSel, randomAmount, { delay: 100 });
await extPage.evaluate(selector => {
  const el = document.querySelector(selector);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
}, amtSel);
log(name, `💸 Введена сумма: ${randomAmount}`);
await delayBeforeAction();                                   

// === Нажимаем «Отправить» ===
const didClickSend = await extPage.evaluate(() => {
  const span = Array.from(document.querySelectorAll('span'))
    .find(el => el.textContent.trim() === 'Отправить');
  if (!span) return false;
  span.closest('button')?.click();
  return true;
});
log(
  name,
  didClickSend
    ? '📤 Кнопка «Отправить» нажата'
    : '⚠️ Кнопка «Отправить» не найдена'
);
await delayBeforeAction();                                   

    // 4) Ошибка 112
    await handleError112(browser, {
      timeout: 5000,
      log: msg => console.log(`[${name}] ${msg}`)
    });
    await delayBeforeAction();

    // 5) Ошибка 429
    await handleError429(browser, {
      timeout: 4000,
      log: msg => console.log(`[${name}] ${msg}`)
    });
    await delayBeforeAction();

    // 6) Подпись транзакции
    await confirmRabbyTransaction(browser, {
      timeout: 30000,
      log: msg => console.log(`[${name}] ${msg}`)
    });
    await delayBeforeAction();

    // 7) Переход на Sahara
    const newTab = await browser.newPage();
    await newTab.setViewport({ width: 1920, height: 1080 });
    await newTab.goto('https://legends.saharalabs.ai/', {
      waitUntil: 'domcontentloaded'
    });
    log(name, '🌐 Sahara открыт');
    await delayBeforeAction();

    // закрыть вкладки Rabby
    const targets = browser.targets();
    for (const target of targets) {
      const url = target.url();
      if (url.startsWith('chrome-extension://')) {
        try {
          const page = await target.page();
          if (page) await page.close();
        } catch (e) {
          log(name, `⚠️ Не удалось закрыть вкладку ${url}: ${e.message}`);
        }
      }
    }
    await delayBeforeAction();

    
    // 15) Перезагрузка Sahara
    try {
      await newTab.bringToFront();
      await newTab.goto('https://legends.saharalabs.ai/', {
        waitUntil: 'domcontentloaded'
      });
      log(name, '🔄 Sahara перезагружена');
    } catch (e) {
      log(name, '⚠️ Ошибка перезагрузки Sahara:', e.message);
    }
    await delayBeforeAction();

    // 16) Нажатие кнопки задания
    const taskBtnSel = '#app > div > div > div:nth-child(5) > div';
    await newTab.waitForSelector(taskBtnSel, { visible: true, timeout: 10000 });
    await newTab.click(taskBtnSel);
    log(name, '🧾 Кнопка задания нажата');
    await delayBeforeAction();


      // 17) Секвенс claim (пример)
      async function handleClaimSequence() {
    await delay(60000);
    log(name, '⏱ Ждём 60 секунд...');
    const taskSelector = 'body > div:nth-child(3) > div > div.ant-modal-wrap.help-center-modal-unique.ant-modal-centered > div > div:nth-child(1) > div > div > div > div.body > div.content > div > div:nth-child(4) > div:nth-child(2) > div.task-actions > div.task-buttons';

    let attempt = 0;
    const maxAttempts = 1;

  while (attempt < maxAttempts) {
    const taskIcon = await newTab.$(`${taskSelector} > div > svg`);
    if (taskIcon) {
      await waitForAndClick(newTab, `${taskSelector} > div > svg`, name, '✅ Иконка выполненного задания нажата');
    } else {
      log(name, '❌ Иконка выполненного задания не найдена, пропуск...');
    }

    await delay(2000);

    const claimButton = await newTab.$(`${taskSelector} > div.task-button-plus`);
    if (claimButton) {
      const isDisabled = await claimButton.evaluate(el => el.disabled);
      if (!isDisabled) {
        await waitForAndClick(newTab, `${taskSelector} > div.task-button-plus`, name, '\x1b[32m🎁 Кнопка "Клейм" нажата\x1b[0m');
        await waitForAndClick(newTab,'body > div:nth-child(3) > div > div.ant-modal-wrap.help-center-modal-unique.ant-modal-centered > div > div:nth-child(1) > div > button',name,'✅ Модальное окно закрыто крестиком');
        await delay(1000);
        await waitForAndClick(newTab,'#app > div > div > div.top-right > div.account > div > div.logout',name,'🚪 Кнопка "Отключиться" нажата');
        return; // Успешно завершено
      } else {
        log(name, `⚠️ Кнопка "Клейм" найдена, но отключена. Перезагрузка (${attempt + 1}/${maxAttempts})...`);
      }
    } else {
      log(name, `🔄 Кнопка "Клейм" не найдена. Перезагрузка (${attempt + 1}/${maxAttempts})...`);
    }

    // Повтор после обновления страницы
    attempt++;
    await newTab.reload({ waitUntil: 'domcontentloaded' });
    await delayBeforeAction();
    await waitForAndClick(newTab, '#app > div > div > div:nth-child(5) > div', name, '🧾 Кнопка задания нажата');
    await delay(60000);
  }

  log(name, '❌ Не удалось выполнить клейм после нескольких попыток');
  await delay(2000);
    try {
      const closeModalSel = `${taskModalSelector} .ant-modal-close`;
      await newTab.waitForSelector(closeModalSel, { visible: true, timeout: 5000 });
      await newTab.click(closeModalSel);
      log(name, '✅ Модальное окно закрыто');
    } catch (_) {
      log(name, 'ℹ️  Модальное окно не найдено или уже закрыто');
    }

    await delay(3000);
    try {
      const logoutSel = '#app > div > div > div.top-right > div.account > div > div.logout';
      await newTab.waitForSelector(logoutSel, { visible: true, timeout: 5000 });
      await newTab.click(logoutSel);
      log(name, '🚪 Нажата кнопка "Отключиться"');
    } catch (_) {
      log(name, '⚠️ Кнопка "Отключиться" не найдена или ошибка при выходе');
    }
  }
  await handleClaimSequence();

    // 18) Закрытие Sahara + сворачивание
    try {
      await newTab.close();
      log(name, '❎ Закрыт сайт Sahara');
    } catch {}
    await delayBeforeAction();

    try {
      const temp = await browser.newPage();
      const sess = await temp.target().createCDPSession();
      const { windowId } = await sess.send('Browser.getWindowForTarget');
      await sess.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'minimized' }
      });
      await temp.close();
      log(name, '🗕  Окно свернуто');
    } catch {}
    await delayBeforeAction();

    // 19) Завершение
    await browser.disconnect();
    log(name, '🚀 Профиль завершён');
    await sendLogShort(`✅ ${scriptName}: завершён ${name}`);
    await delayBeforeAction();

  } catch (err) {
    log(name, '❌ Ошибка:', err.message);
    if (browser) {
      try { await browser.disconnect(); } catch {}
    }
  }
}

// --------------------------------------------
//         Запуск всех профилей
// --------------------------------------------
(async () => {
  for (let i = 0; i < profiles.length; i++) {
    await runProfile(profiles[i], i);
    if (i + 1 < profiles.length) {
      const pause = Math.random() * (120000 - 60000) + 60000;
      console.log(`⏸ Ждём ${Math.round(pause/1000)} с до след. профиля`);
      await delay(pause);
    }
  }
  console.log('✅ Все профили отработаны');
  process.exit(0);
})();