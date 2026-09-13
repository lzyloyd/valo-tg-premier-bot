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
  разбираются в этом же файле:
  - `Резалтик, покажи премьер матч <ссылка>` — то же самое, что было раньше:
    ищет отслеживаемого игрока (`TRACKED_RIOT_ID`) в матче, подтягивает
    Premier-состав/ранг команд, надпись на карточке всегда «Premier».
  - `Резалтик, покажи матч <ссылка>` — карточка по **любому** матчу с
    tracker.gg, даже без отслеживаемого игрока в составе (тогда «наша
    команда» — просто первая по порядку сторона). Без Premier-lookup команд
    (не имеет смысла вне Premier), поэтому имена команд — «Команда
    A»/«Команда B» без ранга. Режим на карточке — настоящий, из данных
    матча (`raw.metadata.queueId` → `Competitive`/`Unrated`/`Premier`/...,
    маппинг в `src/matchModel.js`).
  - `Резалтик, healthcheck` — бот подтверждает, что процесс жив и видит
    сообщения.
  - `Резалтик, расписание` — присылает ссылку на мини-апп «Расписание»
    (см. ниже).

  Новые команды добавляются там же.

## Мини-апп «Расписание»

Telegram Mini App, в котором каждый из ростера отмечает свою доступность на
неделю (Вт–Сб — праки/премьер, Вс — необязательный МСК-турнир). Живёт в
`src/miniappServer.js` (Express, часть того же процесса, что и бот) +
`src/miniapp-public/index.html` (сам интерфейс) + `src/scheduleModel.js` /
`src/scheduleStore.js` (даты недели, кворум, хранение в `data/schedule.json`).

- Неделя открыта на редактирование с **воскресенья 20:00 МСК** (в этот момент
  прошлая неделя удаляется и создаётся новая пустая) до **понедельника 24:00
  МСК**. Любое изменение после дедлайна прилетает алертом в топик «Сборы»
  группы NF // OVT — это же место, откуда открывается сам мини-апп (команда
  «Резалтик, расписание» шлёт ссылку `t.me/<бот>/<short name>`,
  зарегистрированную через `/newapp` в BotFather — обычная inline-кнопка
  `web_app` в группах запрещена правилами Telegram, только в личке с ботом).
- Сводку отправляет туда же только админ (`ADMIN_USER_ID` в `.env`) кнопкой
  внутри мини-аппа — а в 24:00 МСК понедельника (дедлайн) она же уходит сама,
  автоматически. Если после этого кто-то поменял ответ (правка после дедлайна),
  бот не просто алертит — он **редактирует то же самое сообщение** сводки на
  месте (`editMessageText`, id сообщения хранится в `data/schedule.json`), так
  что она всегда отражает актуальный состав.
- Ростер фиксирован в `ROSTER` (`src/scheduleModel.js`) — 7 Telegram-юзернеймов,
  сверяются с данными, которые Telegram сам подписывает при открытии мини-аппа
  (`initData`, проверяется в `src/telegramAuth.js`) — никто не может открыть
  его под чужим именем.
- Кто реально играет каждую сессию решает не сырой кворум, а фиксированный
  состав — `MAIN_ROSTER` (5 основных) и `SUB_ROSTER` (2 замены, в порядке
  предпочтения) в `src/scheduleModel.js`. Правила — `resolveLineup()`: все 5
  основных доступны → играют они; не хватает одного → доступная замена
  закрывает дыру; не хватает двоих → нужны обе замены сразу; меньше 3 основных
  или не набралось нужных замен → сессии нет. Для праков (Вт–Пт) выбирается
  ещё и время дня — то, где основных доступно больше (`computeDaySessions()`);
  Премьер и МСК-турнир такого выбора не требуют, там время фиксировано.
- Итоговый состав по каждой сессии — в авто-сводке, плюс отдельные напоминания
  за 60 и 10 минут до начала (тегают только тех пятерых, кто играет) — уходят
  в главный топик группы (`general`, без `SCHEDULE_THREAD_ID`), не в «Сборы».

### Хостинг мини-аппа (Caddy + DuckDNS)

Telegram открывает `web_app`-кнопки только по HTTPS. Самый лёгкий вариант без
покупки домена — бесплатный поддомен [DuckDNS](https://www.duckdns.org/) +
[Caddy](https://caddyserver.com/) (сам получает и продлевает сертификат
Let's Encrypt):

```bash
# автообновление IP на DuckDNS (на случай смены IP у VPS)
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh <<'EOF'
echo url="https://www.duckdns.org/update?domains=<поддомен>&token=<токен>&ip=" | curl -k -o ~/duckdns/duck.log -K -
EOF
chmod 700 ~/duckdns/duck.sh
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

cat <<'EOF' | sudo tee /etc/caddy/Caddyfile
<поддомен>.duckdns.org {
    reverse_proxy localhost:3001
}
EOF
sudo systemctl restart caddy
```

Порт (`3001`) должен совпадать с `MINIAPP_PORT` в `.env`.

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
