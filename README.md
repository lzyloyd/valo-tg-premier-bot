# Tg Results Bot

Публикует в Telegram scoreboard-картинку по каждому матчу VALORANT Premier
игрока `Space#mench`, как только результат появляется на tracker.gg.

## Как это работает

- tracker.gg встраивает данные последних матчей прямо в HTML страницы профиля
  (`window.__INITIAL_STATE__`), а полный scoreboard матча отдаёт по адресу
  `api.tracker.gg/api/v2/valorant/standard/matches/<id>`.
- Оба пути закрыты Cloudflare для обычных HTTP-запросов (curl и т.п.
  получают `403`), поэтому бот открывает страницу через настоящий headless
  Chromium (Puppeteer + stealth-плагин) и уже из него делает запрос —
  это тот же путь, что использует браузер обычного пользователя.
- Матчи Premier проходят только по субботам в 21:00 и 23:00 МСК, поэтому бот
  не запускает Chromium постоянно — рендерит только дважды в неделю
  (`src/scheduler.js`), остальное время не грузит VPS.
- Новый матч рендерится в PNG (тот же Chromium, свой HTML-шаблон в
  `src/render/template.js`) и отправляется в Telegram как фото с подписью
  (счёт, карта, дата, ссылка на матч).
- Отдельно от расписания бот постоянно слушает сообщения в Telegram
  (`src/telegramListener.js`, long polling — сам по себе почти бесплатный,
  без браузера) и реагирует на обращение **"Резалтик, ..."**. Команды
  разбираются в этом же файле; сейчас есть одна — прислать в сообщении
  ссылку на матч tracker.gg (`Резалтик, дай сводку по матчу <ссылка>`), и
  бот соберёт и пришлёт карточку по этому матчу так же, как по расписанию.
  Новые команды добавляются там же.

## Установка на VPS (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates fonts-liberation libnss3 libatk-bridge2.0-0 \
  libgtk-3-0 libgbm1 libasound2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

```bash
sudo mkdir -p /opt/tg-results-bot
sudo chown $USER:$USER /opt/tg-results-bot
git clone <this repo> /opt/tg-results-bot   # или просто скопировать файлы
cd /opt/tg-results-bot
npm install
cp .env.example .env
```

Заполнить `.env`:

- `TELEGRAM_BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather)
- `TELEGRAM_CHAT_ID` — id группы/канала, куда слать отчёты (добавить бота
  туда, затем например через `@getidsbot` или `getUpdates` узнать chat_id;
  для канала/супергруппы обычно отрицательное число вида `-100...`)
- `TRACKED_RIOT_ID` — Riot ID игрока, от чьего лица считается "наша команда"
  (`Space#mench`)

Проверить, что всё работает, без ожидания субботы:

```bash
npm run test-once
```

Это один раз проверит tracker.gg, и если найдёт непосланные матчи —
отрендерит и отправит их в Telegram сразу.

## Запуск как systemd-сервис (24/7)

```bash
sudo useradd -r -s /usr/sbin/nologin tgbot || true
sudo chown -R tgbot:tgbot /opt/tg-results-bot
sudo cp deploy/tg-results-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tg-results-bot
sudo systemctl status tg-results-bot
journalctl -u tg-results-bot -f
```

## Известные ограничения

- Бот не знает номер "недели"/"карты" турнира (`неделя 4, карта 2`) — на
  tracker.gg такой разметки нет, это ты добавлял вручную. Сейчас в подписи
  идут дата, карта и счёт; если нужна нумерация недель — можно добавить
  свою логику (например, счётчик с ручной привязкой к датам старта Premier).
- Расписание опроса жёстко зашито на субботу 21:00 и 23:00 МСК. Если матч
  где-то надолго задержится и результат на tracker.gg появится позже — бот
  узнает о нём только на следующем плановом опросе (следующая суббота).
- Cloudflare может со временем ужесточить проверки браузерного отпечатка;
  если бот начнёт получать `403` даже через Puppeteer, поможет обновление
  `puppeteer` / `puppeteer-extra-plugin-stealth` до свежих версий.
