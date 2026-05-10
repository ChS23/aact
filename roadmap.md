# Roadmap развития инструментов (или чем можно заняться контрибьюторам)

### Покрытие архитектуры тестами

✅ Покрытие тестами микросервисной архитектуры<br/>
✅ Покрытие тестами архитектуры модульного монолита<br/>
✅ [Справочник](https://github.com/Byndyusoft/aact/blob/main/patterns.md) принципов и паттернов проектирования (в формате ADR)<br/>
✅ Примеры тестов на пункты [справочника](https://github.com/Byndyusoft/aact/blob/main/patterns.md)<br/>
🟩 Добавление реализаций и примеров под разные стэки (сейчас TypeScript и C#)

### CLI и конфигурация (v2)

✅ CLI: `aact check`, `aact analyze`, `aact generate`, `aact init`<br/>
✅ Конфигурация через `aact.config.ts` (`defineConfig`)<br/>
✅ Вывод в форматах text, json, github (для CI)<br/>
✅ Auto-fix нарушений правил с записью обратно в PlantUML

### Источники архитектуры

✅ PlantUML C4<br/>
✅ Structurizr workspace.json<br/>
✅ Kubernetes deploy configs

### Правила валидации (v2)

✅ Anti-corruption Layer (ACL)<br/>
✅ Acyclic Dependencies<br/>
✅ CRUD-сервисы<br/>
✅ Database per service<br/>
✅ API Gateway<br/>
✅ Stable Dependencies<br/>
✅ Cohesion > Coupling<br/>
✅ Common Reuse Principle<br/>
⌛ Оркестратор распределённых транзакций

### Автогенерация

✅ Автогенерация архитектурной схемы по конфигам инфраструктуры<br/>
✅ Генерация PlantUML из модели<br/>
✅ Генерация Kubernetes-конфигов из модели<br/>
🟩 Автогенерация конфигов инфраструктуры по архитектурной схеме<br/>
🟩 Добавление провайдеров для различных реализаций IaC<br/>
🟩 Автогенерация и архитектурной схемы, и конфигов инфраструктуры по архитектурному решению (ADR)

### Инструменты рефакторинга микросервисной архитектуры

🟩 Изменение сигнатуры метода API (endpoint'а)<br/>
🟩 Вынос метода API (endpoint'а) микросервиса в отдельный микросервис<br/>
🟩 Inline микросервиса — поглощение микросервиса своим потребителем
