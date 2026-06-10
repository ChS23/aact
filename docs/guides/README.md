# Гайды

Практические сценарии. [Справочник](../reference/) (правила, команды, форматы —
генерируется из реестров), паттерны и «почему» — [patterns.md](../../patterns.md) и
[ADRs/](../../ADRs).

`✅` готов · `🟩` в работе · `⌛` запланирован

✅ [Моделирование под aact](./modeling.md) — теги `acl`/`repo`/`relay`, boundaries, sync/async<br/>
✅ [Запуск проверки (check)](./check.md) — анатомия нарушения, `--fix`/`--dry-run`, режимы вывода, exit-коды<br/>
✅ [Настройка правил в конфиге](./configuring-rules.md) — opt-in, опции правил, `analyze`<br/>
✅ [Метрики архитектуры (analyze)](./analyze.md) — cohesion/coupling, sync/async, hotspots, циклы<br/>
✅ [CI: SARIF → GitHub Code Scanning](./ci-github-code-scanning.md)<br/>
✅ [Свои правила (custom rules)](./custom-rules.md) — поверх [examples/custom-rules](../../examples/custom-rules)<br/>
✅ [Review diff в PR](./review-diff.md) — `aact diff` / `aact view --diff`<br/>
✅ [Разобраться в архитектуре (view)](./explore-view.md) — режимы Drill/Expand/Flat под задачу

Каждый гайд — `.md` + VHS `.tape` рядом (образец — [docs/demo/demo.tape](../demo/demo.tape)).
