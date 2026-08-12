# Roadmap развития инструментов (или чем можно заняться контрибьюторам)

### Покрытие архитектуры тестами

✅ Покрытие тестами микросервисной архитектуры<br/>
✅ Покрытие тестами архитектуры модульного монолита<br/>
✅ [Справочник](https://github.com/Byndyusoft/aact/blob/main/patterns.md) принципов и паттернов проектирования (в формате ADR)<br/>
✅ Примеры тестов на пункты [справочника](https://github.com/Byndyusoft/aact/blob/main/patterns.md)<br/>

### CLI и конфигурация

✅ CLI: `aact check`, `aact analyze`, `aact generate`, `aact init`<br/>
✅ Конфигурация через `aact.config.ts` (`defineConfig`)<br/>
✅ Вывод в форматах text, json, github (для CI)<br/>
✅ Auto-fix нарушений правил с записью обратно в PlantUML / Structurizr DSL

### Источники архитектуры

✅ PlantUML C4 (load + generate + fix)<br/>
✅ Structurizr workspace.json (load + fix, DSL renderer — отдельный roadmap для v3.x)<br/>
🟩 Kubernetes deploy configs как Model source — v1 имел test-helper `loadMicroserviceDeployConfigs`, который собирал DeployConfig[] (не Model) для diff-проверки PUML vs k8s. В v3 убран как legacy. Реальный «k8s → Model» loader через env-var heuristic + image inference — обсуждается для v3.x<br/>
🟩 Mermaid C4 — планируется в v3.x (shared grammar с PUML stdlib)

### Правила валидации

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

✅ Генерация PlantUML из модели<br/>
✅ Генерация Kubernetes-конфигов из модели (forward, model → manifests)<br/>
🟩 Reverse-engineering архитектурной схемы по k8s/Compose manifests — см. «Источники архитектуры» (v3.x)<br/>
🟩 Структуризатор DSL renderer (Model → workspace.dsl) — v3.x<br/>
🟩 Добавление провайдеров для различных реализаций IaC

### Инструменты рефакторинга микросервисной архитектуры

🟩 Изменение сигнатуры метода API (endpoint'а)<br/>
🟩 Вынос метода API (endpoint'а) микросервиса в отдельный микросервис<br/>
🟩 Inline микросервиса — поглощение микросервиса своим потребителем
