# Моя школа — учебный помощник

Адаптивное учебное приложение: расписание, домашние задания, текстовый анализ, ИИ endpoint и облачная синхронизация.

## Развёртывание в Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/aminusmanovxxx-wq/moja-shkola-netlify)

Нажми кнопку выше, выбери свой аккаунт Netlify и подтверди импорт этого репозитория. Оставь настройки сборки из `netlify.toml`.

Для настоящих нейросетевых ответов добавь `OPENAI_API_KEY` в Netlify → Site configuration → Environment variables. Не помещай ключ в клиентский код или Git. После добавления переменной перезапусти сборку.

Облачное хранилище работает на стороне Netlify; синхронизация требует индивидуального длинного токена. Доступ к МЭШ без официального API этот проект не имитирует.

## Локальная проверка

`npm test`

`npm run typecheck`
