# Plan dla Claude Code: agentcurfew, bezpieczeństwo konfiguracji agentów AI

Stan na 4 listopada 2026 r. Plan jest pisany tak, żeby dało się go wrzucić do pustego repozytorium jako `docs/PLAN.md` i realizować faza po fazie w osobnych sesjach Claude Code. Na końcu pliku są gotowe prompty.

## 1. Po co to narzędzie

Agenci kodujący (Claude Code, Cursor, Codex, Gemini CLI, Copilot i inni) wczytują z repozytorium i z komputera programisty pliki, które sterują ich zachowaniem: skille (`SKILL.md` ze skryptami), konfiguracje serwerów MCP, hooki uruchamiające polecenia, pliki kontekstu (`AGENTS.md`, `CLAUDE.md` i podobne) oraz ustawienia uprawnień. To nowy łańcuch dostaw i jest już atakowany:

- **ToxicSkills (Snyk, luty 2026 r.):** z 3984 przeskanowanych skilli 36,8% miało luki bezpieczeństwa, 13,4% krytyczne, 76 zawierało potwierdzony złośliwy kod, a 5 z 7 najczęściej pobieranych skilli okazało się malware.
- **ClawHub:** 341 złośliwych skilli udających narzędzia produktywności. OWASP opisuje kampanię ClawHavoc z 1184 złośliwymi skillami.
- **Ukryte instrukcje:** niewidoczne znaki Unicode (Tag characters) w `SKILL.md` użyte do wykradania repozytorium.
- **Trwałość:** skille dopisujące złośliwe instrukcje do `CLAUDE.md` lub `AGENTS.md`, żeby przetrwać usunięcie skilla.
- **Robak tensorlake (październik 2026 r.)** podkładał pliki `.claude/settings.json` i `.vscode/tasks.json`.
- **Luki w samych agentach:** pliki konfiguracyjne z repozytorium pozwalały na wykonanie poleceń i kradzież kluczy API w Claude Code (CVE-2025-59536, CVE-2026-21852, obie załatane).

Cloud Security Alliance wskazuje cztery główne luki po stronie firm: brak **inwentaryzacji** (nikt nie wie, jakie pliki kontekstu i skille są na komputerach i w repozytoriach), brak **polityki**, brak **weryfikacji pochodzenia** (rejestry skilli bez podpisów i sum kontrolnych) oraz brak standardowego skanowania. OWASP opublikował listę Agentic Skills Top 10 (wersja 1.0-2026).

**Konkurencja:**
- Na npm wszystkie skanery agentów mają poniżej 1,1 tys. pobrań tygodniowo i nie ma lidera. Nazwy `agentseal`, `skillseal`, `agentpin`, `agentward` są zajęte przez małe projekty.
- **Snyk Agent Scan** (3,2 tys. gwiazdek) wymaga konta w Snyk, wysyła treść skilli, opisy narzędzi MCP i konfiguracje do API Snyk, uruchamia znalezione serwery MCP, żeby pobrać ich opisy, i nie jest publikowany na npm.
- Instalator **`skills`** od Vercela (5,5 mln pobrań tygodniowo) prowadzi `skills-lock.json` z sumą kontrolną każdego skilla (`computedHash`), ale tylko dla skilli zainstalowanych przez siebie. Nie obejmuje serwerów MCP, hooków, plików kontekstu ani skilli dodanych ręcznie.

**Cel:** lokalne, bezkontowe narzędzie, które inwentaryzuje wszystko, co steruje agentami w projekcie, zapisuje to w pliku blokady z sumami kontrolnymi, pilnuje polityki i wykrywa groźne wzorce, **niczego nie uruchamiając i niczego nie wysyłając**.

**Podział z depcurfew (według tego, co jest chronione, a nie kto coś uruchamia):**

| | depcurfew | agentcurfew |
|---|---|---|
| Chroni | Paczki instalowane do projektu (npm, PyPI, Composer, Bundler…), także wtedy, gdy instaluje je agent | To, co steruje agentem: skille, definicje serwerów MCP, hooki, pliki kontekstu, uprawnienia |
| Funkcje dla agentów | `check`, hook sprawdzający polecenia instalacji, serwer MCP, dane OSV (już opublikowane w 1.5.x) | Hook pilnujący dodawania skilli i serwerów MCP oraz zmian w plikach konfiguracji i kontekstu agenta |
| Punkt styku | Serwer MCP uruchamiany przez `npx` lub `uvx` to jednocześnie paczka i komponent agenta: agentcurfew wykrywa i przypina jego definicję, a sprawdzenie samej paczki deleguje do biblioteki depcurfew | |

agentcurfew nie sprawdza paczek instalowanych przez agenta i nie ma własnej logiki wieku wersji, podobnych nazw ani znanych złośliwych wersji. Funkcje depcurfew dla agentów zostają w depcurfew: korzystają z tej samej polityki i danych, a ich usunięcie zepsułoby hooki użytkowników, którzy mają już w `.claude/settings.json` ścieżkę do `depcurfew/dist/cli.js`.

**Wyróżniki:**
1. Wszystko lokalnie, bez konta i bez sieci. Firmy, które nie mogą wysyłać konfiguracji na zewnątrz, nie mają dziś alternatywy.
2. Skaner nigdy nie uruchamia tego, co skanuje: żadnych serwerów MCP, skryptów ani hooków.
3. Jeden plik blokady dla wszystkich agentów i typów komponentów, zgodny z `skills-lock.json`, a nie konkurujący z nim.
4. Reguły deterministyczne zamiast zgadywania intencji modelem: każde ostrzeżenie da się wyjaśnić i odtworzyć.
5. Ta sama filozofia i marka co depcurfew: plik polityki, `doctor` wykrywający konfigurację, która po cichu nie działa, SARIF, GitHub Action.

**Model zarabiania:** CLI na MIT, płatna usługa dla organizacji, wspólna z płatną warstwą depcurfew (sekcja 9).

## 2. Nazwa

**agentcurfew**, alias CLI `acf` (tak jak `dcf` w depcurfew). Sprawdzone 4 listopada 2026 r.: `agentcurfew`, `agent-curfew` i `agent_curfew` wolne na npm, scope `@agentcurfew` wolny, wolne na PyPI, crates.io i GitHubie, brak dokładnych trafień w wyszukiwarce. Domen i znaków towarowych nie dało się sprawdzić.

**Zarezerwować przed startem:** paczkę `agentcurfew` i organizację `@agentcurfew` na npm, organizację na GitHubie, domenę. Przed publikacją sprawdzić, czy alias `acf` nie koliduje z popularnym narzędziem w PATH; jeśli koliduje, zostawić tylko `agentcurfew`.

## 3. Zakres

**W MVP (wersja 1.0, darmowe CLI):**
- `acf scan`: inwentaryzacja i skanowanie komponentów agentów w projekcie. Komputer programisty (konfiguracja użytkownika, np. w katalogu domowym) tylko po jawnej fladze `--user`.
- `acf lock`: zapis pliku blokady `agentcurfew.lock` z sumami kontrolnymi.
- `acf verify`: porównanie stanu z plikiem blokady, do CI (wykrywanie dryfu, OWASP AST07).
- `acf init`: tworzy plik polityki dopasowany do wykrytych agentów.
- `acf doctor`: konfiguracja, która nie działa albo jest ignorowana.
- `acf explain <id-reguły>`: co wykryto, dlaczego to groźne, jak naprawić.
- Wyjście: tekst dla ludzi, JSON i SARIF. GitHub Action.
- `acf mcp`: serwer MCP tylko do odczytu, żeby agent mógł sprawdzić skill albo serwer MCP **przed** instalacją.

**Komponenty do wykrywania (każdy w bazie wiedzy, ze źródłem):**
- skille (`SKILL.md` z metadanymi i dołączonymi skryptami),
- konfiguracje serwerów MCP (lokalne: polecenie, argumenty, zmienne środowiskowe; zdalne: adres),
- hooki agentów i inne polecenia uruchamiane automatycznie,
- zadania edytora uruchamiane przy otwarciu folderu (np. `.vscode/tasks.json`),
- pliki kontekstu i reguł (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, instrukcje Copilota, reguły Cursora i Windsurfa),
- ustawienia uprawnień agentów,
- podagenci i własne polecenia, jeśli agent je obsługuje.

**Poza zakresem MIT:** ocena intencji tekstu modelem językowym, blokowanie wykonania w locie (to rola samego agenta i zapór), własna baza złośliwych skilli.

**Poza zakresem na stałe (to robi depcurfew):** sprawdzanie paczek instalowanych przez agenta (`npm install`, `pip install` itd.), wiek wersji, podobne nazwy paczek, znane złośliwe wersje z OSV.

## 4. Reguły na start

Każda reguła ma identyfikator, poziom, opis, przykład, podpowiedź naprawy, odwołanie do OWASP AST i fiksturę pozytywną oraz negatywną.

| Reguła | Co wykrywa | OWASP |
|---|---|---|
| Ukryte znaki | Unicode Tag characters (U+E0000–U+E007F), znaki sterujące kierunkiem tekstu (np. U+202A–U+202E, U+2066–U+2069), znaki o zerowej szerokości w plikach kontekstu, skillach i opisach | AST04, AST08 |
| Niepiętowany serwer MCP | `npx -y paczka` bez wersji, `@latest`, `uvx` bez wersji, obrazy kontenerów bez skrótu | AST02, AST07 |
| Niezaszyfrowany serwer zdalny | Serwer MCP przez `http://` poza localhost | AST02 |
| Sekrety w konfiguracji | Klucze i tokeny wpisane wprost w konfigurację MCP lub ustawienia | AST04 |
| Groźne polecenia w hookach | Pobieranie i wykonywanie (`curl … \| sh` i podobne), połączenia sieciowe, zapis do plików kontekstu | AST01, AST06 |
| Automatyczne uruchamianie | Zadania i hooki startujące przy otwarciu projektu bez akcji użytkownika | AST06 |
| Zbyt szerokie uprawnienia | Skill lub ustawienia zezwalające na dowolne polecenia powłoki albo tryb pomijania zgód zapisany w projekcie | AST03 |
| Treść z zewnątrz | Skrypty skilla pobierające instrukcje lub kod z sieci w czasie działania | AST05 |
| Zaciemniony kod | Długie bloki base64, minifikowany kod lub binaria w folderze skilla | AST01 |
| Wzorzec trwałości | Instrukcje każące agentowi modyfikować inne pliki kontekstu lub konfigurację agenta | AST01 |
| Dryf | Komponent zmienił się względem pliku blokady | AST07 |
| Poza polityką | Źródło skilla lub serwer MCP spoza listy dozwolonych | AST09 |

Reguły heurystyczne (np. wzorzec trwałości) mają niższy poziom i jasno opisaną możliwość fałszywego alarmu. Dokumentacja mówi uczciwie, czego narzędzie **nie** wykryje: manipulacji językowej bez charakterystycznych wzorców (OWASP AST08).

## 5. Plik blokady i polityka

**`agentcurfew.lock`** (JSON, deterministyczne sortowanie, żeby diff w PR był czytelny):
- skille: ścieżka, źródło, suma kontrolna całego folderu, lista plików wykonywalnych,
- serwery MCP: agent, plik konfiguracji, polecenie i argumenty albo adres, rozpoznana paczka i wersja, suma kontrolna wpisu,
- hooki i zadania automatyczne: treść polecenia i jego suma kontrolna,
- pliki kontekstu: suma kontrolna treści.

Jeśli w projekcie jest `skills-lock.json`, `acf verify` porównuje sumy kontrolne skilli z tym plikiem i zgłasza rozbieżności, zamiast prowadzić drugą, niezależną listę. Format `skills-lock.json` i sposób liczenia `computedHash` trzeba sprawdzić w kodzie źródłowym `skills` (polecenie `experimental_install` jest oznaczone jako eksperymentalne).

**Plik polityki** (`agentcurfew.policy.json` z JSON Schema), przykład:

```json
{
  "$schema": "https://unpkg.com/agentcurfew/schema.json",
  "version": 1,
  "skills": {
    "allowSources": ["github:moja-firma/*", "vercel-labs/agent-skills"],
    "allowExecutables": false
  },
  "mcp": {
    "requirePinnedVersions": true,
    "allowServers": ["@modelcontextprotocol/server-filesystem", "https://mcp.moja-firma.pl/*"],
    "denyPlainHttp": true
  },
  "hooks": { "allowNetwork": false, "allowAutoRunOnOpen": false },
  "contextFiles": { "denyHiddenUnicode": true },
  "failOn": "high"
}
```

## 6. Bezpieczeństwo samego skanera

Skaner czyta pliki przygotowane przez atakującego, więc:
- **Nigdy nie uruchamia** znalezionych poleceń, skryptów, hooków ani serwerów MCP. To twarda reguła i świadoma różnica wobec narzędzi, które startują serwery MCP, żeby pobrać ich opisy.
- **Bez sieci, zawsze.** Sprawdzenia, które potrzebują danych o paczkach (wiek wersji, znane złośliwe wersje), deleguje do depcurfew, który ma do tego własne, lokalne dane OSV.
- Limity: rozmiar pliku, głębokość katalogów, liczba plików, ochrona przed bombami YAML i JSON, nieprzechodzenie przez dowiązania symboliczne poza projekt.
- Wyniki nie zawierają pełnych sekretów (maskowanie).
- Fuzzing parserów.

## 7. Plik CLAUDE.md dla repozytorium

Wkleić jako `CLAUDE.md` w katalogu głównym:

```markdown
# Zasady projektu agentcurfew

## Cel
Lokalne CLI na MIT, które inwentaryzuje komponenty sterujące agentami AI (skille, serwery MCP, hooki, pliki kontekstu, uprawnienia), zapisuje je w pliku blokady, pilnuje polityki i wykrywa groźne wzorce. Plan: docs/PLAN.md.

## Twarde reguły
- Skaner NIGDY nie uruchamia znalezionych poleceń, skryptów, hooków ani serwerów MCP i nie korzysta z sieci.
- Nie dublujemy depcurfew: sprawdzanie paczek instalowanych przez agenta, wiek wersji, podobne nazwy i dane OSV należą do depcurfew. Gdy potrzebujemy sprawdzić paczkę (np. serwer MCP uruchamiany przez npx lub uvx), używamy publicznego API biblioteki depcurfew jako opcjonalnej zależności (peer), a nie piszemy tej logiki drugi raz.
- Zależności w czasie działania: tylko `yaml`, jeśli to konieczne do konfiguracji w TOML jeden parser TOML bez zależności przechodnich, oraz `depcurfew` jako opcjonalna zależność peer. Każdą zależność uzasadnij w docs/decisions.md i zapytaj mnie przed dodaniem.
- Wszystkie fakty o agentach (ścieżki plików, formaty, pierwszeństwo konfiguracji, schematy hooków i MCP, format skilli) żyją wyłącznie w src/knowledge/. Każdy wpis ma `source` (URL oficjalnej dokumentacji lub kodu źródłowego) i `verifiedAt`. Test odrzuca wpis bez źródła.
- Nigdy nie wpisuj faktu o agencie z pamięci. Sprawdź w aktualnej dokumentacji (WebFetch/WebSearch) i dopisz źródło. Sprzeczne źródła zapisz oba i oznacz pole jako sporne.
- Każda reguła ma identyfikator, poziom, opis, odwołanie do OWASP Agentic Skills Top 10, podpowiedź naprawy, wpis w docs/rules.md oraz fiksturę pozytywną i negatywną.
- Pliki wejściowe są niezaufane: limity rozmiaru i głębokości, brak przechodzenia przez dowiązania symboliczne poza projekt, maskowanie sekretów w wynikach.
- Plik blokady jest deterministyczny: stałe sortowanie, brak znaczników czasu w treści, ścieżki względne.
- Tylko ESM, bez top-level await.
- Kod, komentarze, dokumentacja i komunikaty CLI po angielsku.
- Testy nie korzystają z sieci; fikstury w tests/fixtures.
- Nie publikujemy na npm, nie wypychamy zmian i nie tworzymy kont bez mojej zgody.

## Polecenia
- `npm test` – testy (Vitest), w tym fikstury reguł i migawki CLI
- `npm run fuzz` – fuzzing parserów
- `npm run build` – build przez tsdown
- `npm run check:pkg` – publint i @arethetypeswrong/cli

## Sposób pracy
- Jedna faza planu na sesję. Na początku przeczytaj docs/PLAN.md, docs/decisions.md i docs/CHANGELOG-dev.md.
- Zacznij w trybie planowania i poczekaj na moją akceptację.
- Najpierw testy i fikstury, potem implementacja.
- Na koniec fazy: podsumowanie w docs/CHANGELOG-dev.md, commit, lista decyzji i niepewności do mojego przeglądu.
```

## 8. Fazy

Szacunki są orientacyjne i dotyczą pracy z Claude Code przy bieżącym przeglądzie zmian.

### Faza 0: Szkielet (0,5 dnia)

> Utwórz szkielet CLI w TypeScript zgodnie z CLAUDE.md: ESM-only, tsdown, Vitest, fast-check, publint, @arethetypeswrong/cli, pliki wykonywalne `agentcurfew` i `acf`, parser argumentów na wbudowanym `util.parseArgs`. Sprawdź w aktualnej dokumentacji bieżące wersje narzędzi. Dodaj licencję MIT, `SECURITY.md` i plik polityki depcurfew dla samego repozytorium.

**Kryteria:** `acf --help` działa, testy i `check:pkg` przechodzą, w zależnościach co najwyżej `yaml`.

### Faza 1: Baza wiedzy o agentach (1–2 dni)

Najważniejsza faza: baza wiedzy to jednocześnie największa wartość i największy koszt utrzymania.

> Zbuduj src/knowledge/ z jednym modułem na agenta. Dla każdego ustal z oficjalnej dokumentacji lub kodu źródłowego: pliki konfiguracji na poziomie projektu i użytkownika, ich format, kolejność pierwszeństwa, gdzie definiuje się serwery MCP i w jakim schemacie, gdzie i jak definiuje się hooki, gdzie leżą skille i jaki mają format, jakie pliki kontekstu i reguł agent wczytuje, gdzie są ustawienia uprawnień. Każde pole ma `source` i `verifiedAt`. Wygeneruj docs/knowledge.md z czytelną tabelą.

Agenci do objęcia na start: Claude Code, Cursor, OpenAI Codex CLI, Gemini CLI, GitHub Copilot w VS Code, Windsurf, Cline. Punkty wyjścia, **każdy do weryfikacji**: `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `.claude/skills/`, `CLAUDE.md`, `.cursor/mcp.json`, `.cursor/rules/`, `.vscode/mcp.json`, `.vscode/tasks.json`, `.github/copilot-instructions.md`, `.gemini/settings.json`, `GEMINI.md`, konfiguracja Codex w TOML, `AGENTS.md`, `.windsurf/rules/`. Format skilli sprawdzić w specyfikacji Agent Skills i w instalatorze `skills` od Vercela, w tym jego plik `skills-lock.json`.

**Kryteria:** każdy wpis ma źródło i datę, sporne fakty oznaczone, tabela w docs/knowledge.md.

### Faza 2: Inwentaryzacja (1 dzień)

> Zaimplementuj wykrywanie komponentów według bazy wiedzy: skille, serwery MCP, hooki, zadania automatyczne edytora, pliki kontekstu, ustawienia uprawnień, podagenci i polecenia. Każdy komponent ma typ, agenta, plik źródłowy, zakres (projekt lub użytkownik) i surową treść do dalszej analizy. `acf scan --inventory --json` wypisuje listę. Przygotuj co najmniej 15 fikstur repozytoriów z różnymi kombinacjami agentów.

**Kryteria:** wszystkie fikstury poprawnie zinwentaryzowane, nic nie jest uruchamiane (test sprawdza, że skaner nie wywołuje procesów potomnych), dowiązania symboliczne poza projekt są pomijane.

### Faza 3: Reguły (2–3 dni)

> Zaimplementuj silnik reguł i reguły z sekcji 4 planu. Każda reguła ma identyfikator, poziom, opis, odwołanie do OWASP Agentic Skills Top 10 (sprawdź aktualną listę AST01–AST10 w repozytorium OWASP), podpowiedź naprawy i fiksturę pozytywną oraz negatywną. Dla ukrytych znaków Unicode wypisz w wyniku, gdzie są i jak wyglądają (np. jako kody U+…), bo w edytorze ich nie widać. Sekrety maskuj w wynikach. Napisz docs/rules.md.

**Kryteria:** każda reguła ma oba testy, fuzzing parserów bez awarii, czas skanu typowej fikstury poniżej sekundy.

### Faza 4: Plik blokady i weryfikacja (1–2 dni)

> Zaimplementuj `acf lock` i `acf verify` według sekcji 5. Plik blokady deterministyczny, czytelny w diffie. `acf verify` kończy się błędem przy dryfie i pokazuje, co dokładnie się zmieniło. Jeśli w projekcie jest `skills-lock.json`, sprawdź w kodzie źródłowym `skills`, jak liczony jest `computedHash`, i porównuj z nim sumy kontrolne skilli. Zapisz decyzję w docs/decisions.md.

**Kryteria:** dwa kolejne `acf lock` bez zmian dają identyczny plik, każda zmiana komponentu jest wykrywana, zgodność z `skills-lock.json` sprawdzona testem.

### Faza 5: Polityka i `doctor` (1–2 dni)

> Zaimplementuj plik polityki z JSON Schema, walidację z czytelnymi błędami i `acf init`, który proponuje politykę na podstawie inwentaryzacji. Zaimplementuj `acf doctor` wykrywający konfigurację, która nie działa: plik w złym miejscu albo o złej nazwie (agent go zignoruje), nadpisanie ustawień projektu przez lokalne ustawienia, zduplikowane serwery MCP o sprzecznych definicjach, przestarzałe formaty, które nowa wersja agenta pomija. Każdy przypadek ze źródłem w bazie wiedzy.

**Kryteria:** każda reguła `doctor` ma test pozytywny i negatywny, polityka spoza schematu daje błąd ze ścieżką do pola.

### Faza 6: CLI dla ludzi, SARIF i GitHub Action (1 dzień)

> Zastosuj zasady CLI z depcurfew i xlvane: ekran powitalny z najczęstszymi poleceniami, `help` z przykładami do skopiowania, błędy w trzech częściach (co, gdzie, co zrobić), podpowiedzi przy literówkach, `NO_COLOR`, żadna informacja przekazywana wyłącznie kolorem, `--json` ze schematem w docs/cli-json.md. Dodaj SARIF i GitHub Action przypięty do SHA. Testy migawkowe ekranów.

**Kryteria:** każde polecenie ma pomoc z przykładami, które działają w teście, SARIF przechodzi walidację schematu, Action działa na repozytorium testowym.

### Faza 7: Serwer MCP i hook przed instalacją (1 dzień)

> Zbuduj `acf mcp` (osobna paczka `@agentcurfew/mcp`, jeśli wymaga SDK MCP): narzędzia tylko do odczytu `scan_project`, `check_skill` (analiza skilla z lokalnej ścieżki przed instalacją), `check_mcp_config`, `explain_rule`. Sprawdź aktualną specyfikację MCP i wersję SDK. Przygotuj hook dla Claude Code, który blokuje niezgodne z polityką: dodanie skilla (np. `npx skills add`), dodanie serwera MCP (np. polecenie agenta do dodawania serwerów) oraz zapis przez agenta do plików konfiguracji i kontekstu (`.mcp.json`, `.claude/settings.json`, `SKILL.md`, `CLAUDE.md`, `AGENTS.md` i inne z bazy wiedzy), czyli wzorzec trwałości ze skilli. Sprawdź w aktualnej dokumentacji, jak działają hooki przed użyciem narzędzia i jak współistnieje kilka hooków na tym samym dopasowaniu.
>
> Hook nie sprawdza poleceń instalacji paczek; to robi już hook depcurfew (`PreToolUse` na `Bash|PowerShell|Monitor`). `acf init` wykrywa istniejący hook depcurfew w `.claude/settings.json` i dopisuje hook agentcurfew obok niego, bez duplikatów i bez zmiany wpisu depcurfew.

**Kryteria:** testy serwera na kliencie w pamięci, hook opisany w README i sprawdzony na fiksturze, w tym na fiksturze z istniejącym hookiem depcurfew (oba hooki działają, żaden nie jest nadpisany).

### Faza 8: Integracja z depcurfew (0,5–1 dnia)

> Sprawdź w aktualnej wersji depcurfew jego publiczne API (w 1.5.2 są m.in. `checkSpec`, `checkSpecs`, `loadPolicy`, `LocalOsvData`) i opisz w docs/decisions.md, jak z niego korzystać. Dodaj `depcurfew` jako opcjonalną zależność peer. Gdy depcurfew jest zainstalowany, dla serwerów MCP uruchamianych przez `npx` lub `uvx` wywołuj jego sprawdzenie paczki (polityka repozytorium, podobne nazwy, znane złośliwe wersje z lokalnych danych OSV) i pokazuj wynik jako zwykłe ustalenie agentcurfew. Gdy depcurfew nie jest zainstalowany, zostaje reguła o niepiętowanym serwerze i podpowiedź `npx depcurfew check <paczka>`. Dodaj reguły `doctor`:
> - w repozytorium jest `depcurfew.json`, a w konfiguracji Claude Code brakuje hooka depcurfew (agent może instalować paczki bez kontroli),
> - hook depcurfew wskazuje na nieistniejącą ścieżkę (np. brak `node_modules/depcurfew`), więc po cichu niczego nie pilnuje.
>
> Testy bez sieci, z depcurfew zainstalowanym i bez niego.

**Kryteria:** działa z depcurfew i bez niego, żadna logika sprawdzania paczek nie jest skopiowana z depcurfew, obie reguły `doctor` mają test pozytywny i negatywny.

### Faza 9: Bezpieczna publikacja (0,5 dnia, z Pana udziałem)

> Przygotuj publikację z tagu przez trusted publishing (OIDC) z proweniencją, bez tokenów npm w sekretach, z publikacją etapową i zatwierdzeniem z 2FA. Sprawdź aktualną dokumentację npm i opisz ręczne kroki w docs/RELEASING.md. Uruchamiaj `acf verify` i `dcf doctor` na samym repozytorium w CI.

Ręcznie po Pana stronie: konfiguracja trusted publishing na npmjs.com, 2FA, zatwierdzanie wydań.

**Kryteria:** wydanie ma proweniencję, repozytorium przechodzi własne `acf verify`.

### Faza 10 (po zdobyciu użytkowników): płatna usługa dla organizacji

> **Zmienione 2026-11-08 (D-040, D-041):** najpierw płatny pilot audytu z 5–10 firmami bez budowania usługi, potem jeden produkt self-hosted dla obu narzędzi; usługa hostowana dopiero na wyraźne żądanie płacących klientów. Granica MIT/PRO jest w D-040. Opis poniżej zostaje jako pierwotny pomysł.

Kod w **osobnym, prywatnym repozytorium**, najlepiej wspólnym z płatną warstwą depcurfew. Darmowe CLI działa w pełni bez usługi.

> Zbuduj usługę, która dla organizacji: zbiera wyniki `acf scan --json` z repozytoriów (GitHub App) i z komputerów programistów (agent instalowany przez dział IT, wysyłający wyłącznie inwentaryzację i sumy kontrolne, nigdy treść plików), pokazuje jedną inwentaryzację agentów, skilli i serwerów MCP w firmie, przechowuje centralną politykę i rejestr zatwierdzonych skilli z podpisami, wysyła alerty przy dryfie i generuje raporty audytowe dla SOC 2 i ISO 27001.

Przed tą fazą porozmawiać z 5–10 firmami używającymi CLI i potwierdzić, za co zapłacą.

## 9. Model zarabiania przy MIT

| Co | Licencja | Cena (założenie ilustracyjne) |
|---|---|---|
| CLI: scan, lock, verify, policy, doctor, SARIF, GitHub Action, serwer MCP | MIT, za darmo | 0 |
| Inwentaryzacja w całej firmie (repozytoria i komputery), centralna polityka, rejestr zatwierdzonych skilli, alerty dryfu, raporty audytowe, SSO | Komercyjna, hostowana | Za darmo dla open source i do 5 programistów, potem ok. 10 USD za programistę miesięcznie |
| Pakiet z płatnym depcurfew | Komercyjna | Jedna subskrypcja z rabatem za oba produkty |

Dlaczego to odporne na AI: przychód pochodzi z inwentaryzacji, weryfikacji i audytu, czyli z rzeczy, których agent sam nie wygeneruje. Im więcej agentów i skilli w firmie, tym większa potrzeba kontroli. Dla porównania Socket bierze 25 USD za programistę miesięcznie.

## 10. Dystrybucja

- **Mapowanie na OWASP Agentic Skills Top 10** w dokumentacji: działy bezpieczeństwa szukają narzędzi według tej listy.
- **Wzmianka w depcurfew:** gdy `dcf doctor` znajdzie konfigurację agentów, jedna dyskretna, prawdziwa wskazówka, że agentcurfew może ją sprawdzić, z możliwością wyłączenia. Bez nachalnej reklamy.
- **Artykuł techniczny** o tym, czego nie widać w plikach agentów (ukryty Unicode, niepiętowane serwery MCP), z przykładami na własnych fiksturach. Jeśli przy okazji znajdzie Pan problem w cudzym publicznym projekcie, zgłasza go Pan prywatnie opiekunom, a nie publicznie.
- **GitHub Marketplace** dla Action, rejestry serwerów MCP, katalogi skilli.
- **Integracja z `skills`**: zgodność z `skills-lock.json` jako argument dla użytkowników instalatora Vercela.

## 11. Ryzyka

- **Snyk, Socket lub Vercel dodadzą to samo za darmo.** Obrona: lokalność bez konta, zakaz uruchamiania skanowanych komponentów, jeden plik blokady dla wielu agentów, marka depcurfew.
- **Szybkie zmiany formatów agentów.** Baza wiedzy ze źródłami i cotygodniowe zadanie sprawdzające changelogi agentów.
- **Fałszywe alarmy.** Reguły deterministyczne, jasne poziomy, łatwe wyjątki w polityce z wymaganym uzasadnieniem.
- **Fałszywe poczucie bezpieczeństwa.** Dokumentacja mówi wprost, czego narzędzie nie wykrywa (manipulacja językowa bez wzorców).
- **Głośny rynek małych skanerów.** Wygrywa zaufanie: proweniencja, zero zależności, przejrzyste reguły, historia depcurfew.

## 12. Podsumowanie czasu

| Faza | Czas |
|---|---|
| 0. Szkielet | 0,5 dnia |
| 1. Baza wiedzy o agentach | 1–2 dni |
| 2. Inwentaryzacja | 1 dzień |
| 3. Reguły | 2–3 dni |
| 4. Plik blokady | 1–2 dni |
| 5. Polityka i `doctor` | 1–2 dni |
| 6. CLI, SARIF, Action | 1 dzień |
| 7. Serwer MCP i hook | 1 dzień |
| 8. Integracja z depcurfew | 0,5–1 dnia |
| 9. Publikacja | 0,5 dnia |
| **Razem do wersji 1.0** | **ok. 9–14 dni roboczych** |
| 10. Płatna usługa | po potwierdzeniu popytu, wspólnie z depcurfew |

## 13. Prompty dla Claude Code

Przygotowanie: plan zapisać jako `docs/PLAN.md`, a blok z sekcji 7 wkleić jako `CLAUDE.md`.

**Pierwsza sesja (fazy 0 i 1):**

```
Budujesz agentcurfew: lokalne CLI na licencji MIT, które inwentaryzuje komponenty sterujące agentami AI (skille, serwery MCP, hooki, pliki kontekstu, uprawnienia), zapisuje je w pliku blokady, pilnuje polityki i wykrywa groźne wzorce. To siostrzany projekt depcurfew.

Najpierw przeczytaj CLAUDE.md i docs/PLAN.md. Plan jest nadrzędny: realizuj go faza po fazie i nie przeskakuj do przodu.

W tej sesji zrealizuj tylko fazę 0 (szkielet) i fazę 1 (baza wiedzy o agentach).

Sposób pracy:
1. Zacznij w trybie planowania. Przedstaw plan obu faz i poczekaj na moją akceptację.
2. Najpierw testy, potem implementacja.
3. W fazie 1 każdy fakt o agentach ustal z oficjalnej dokumentacji lub kodu źródłowego przez WebFetch/WebSearch. Nie wpisuj niczego z pamięci. Każde pole ma source (URL) i verifiedAt (dzisiejsza data). Ścieżki wymienione w docs/PLAN.md to punkty wyjścia do weryfikacji, a nie pewnik.
4. Sprawdź, czy nazwa agentcurfew jest nadal wolna na npm i czy alias acf nie koliduje z popularnym narzędziem. Wynik zapisz w docs/decisions.md.

Twarde reguły:
- Skaner nigdy niczego nie uruchamia i nie korzysta z sieci.
- Nie dubluj depcurfew: sprawdzanie paczek instalowanych przez agenta należy do depcurfew.
- W zależnościach w czasie działania tylko yaml; o każdą inną zależność zapytaj mnie.
- Tylko ESM, bez top-level await. Kod i dokumentacja po angielsku.
- Nie publikuj na npm, nie wypychaj zmian, nie twórz kont.

Na koniec sesji:
- uruchom npm test i npm run check:pkg i upewnij się, że przechodzą,
- wygeneruj docs/knowledge.md z tabelą bazy wiedzy i linkami do źródeł,
- dopisz podsumowanie do docs/CHANGELOG-dev.md i zrób commit,
- pokaż mi listę faktów spornych i niepewnych do przeglądu,
- zatrzymaj się i nie zaczynaj fazy 2.
```

**Kolejne sesje (podmienić numer, jedna faza na sesję):**

```
Przeczytaj CLAUDE.md, docs/PLAN.md, docs/decisions.md i docs/CHANGELOG-dev.md. Zrealizuj fazę [NUMER] z docs/PLAN.md i nic poza nią.

Zacznij w trybie planowania i poczekaj na moją akceptację. Najpierw testy i fikstury, potem implementacja. Każdy nowy fakt o agentach dodawaj wyłącznie do src/knowledge/ ze źródłem i datą weryfikacji. Trzymaj się twardych reguł z CLAUDE.md. Nie publikuj na npm i nie wypychaj zmian bez mojej zgody.

Faza jest skończona, gdy spełnia kryteria akceptacji z planu i npm test przechodzi. Wtedy dopisz podsumowanie do docs/CHANGELOG-dev.md, zrób commit, wypisz decyzje do mojego przeglądu i zatrzymaj się.
```

Kolejność: 0 i 1, potem 2, 3, 4, 5, 6, 9 (pierwsze wydanie), następnie 7 i 8.

## 14. Źródła

- [CSA Research Note: Agent Context Poisoning (maj 2026)](https://labs.cloudsecurityalliance.org/research/csa-research-note-skill-md-agent-context-poisoning-20260506)
- [OWASP Agentic Skills Top 10](https://github.com/OWASP/www-project-agentic-skills-top-10)
- [Snyk Agent Scan](https://github.com/snyk/agent-scan)
- [Instalator skills (Vercel), w tym skills-lock.json](https://www.npmjs.com/package/skills)

## 15. Po 1.1.0: kierunek z burzy mózgów (2026-11-08)

Trzy niezależne analizy (produkt, zarabianie, technika i ryzyko) dały wspólne wnioski, a Pan podjął decyzje D-040 i D-041:

- **Granica MIT/PRO (D-040):** wszystko, czego potrzebuje jedna osoba albo jedno repozytorium, zostaje w MIT na zawsze, w tym każda reguła i baza wiedzy. Płatne może być tylko to, co dotyczy wielu repozytoriów naraz, dowody dla audytora, kuracja i czas autora. CLI nigdy nie dostaje telemetrii ani sprawdzania licencji.
- **PRO (D-041):** najpierw płatny pilot audytu z 5–10 firmami, bez budowania usługi. Jeśli co najmniej 3 zapłacą, powstaje jeden produkt self-hosted dla obu narzędzi. Usługa hostowana powstaje dopiero na żądanie płacących klientów, a sieć ma wtedy tylko osobny kolektor bez zależności.

Kolejne fazy MIT, w proponowanej kolejności (każda w osobnej sesji, z planem do akceptacji):

| Faza | Zakres | Wysiłek |
| --- | --- | --- |
| 11 (zrobiona, 1.1.0) | Ustawienia uruchamiające polecenia, skrypty hooków | — |
| 12 (zrobiona, 1.1.0) | Stałe `id`, `producer`, sumy w JSON, `lockDigest`, SARIF v2 | — |
| 13 | Q-016 część 2: `env` / `ANTHROPIC_BASE_URL`, pilnowanie zapisów do skryptów hooków w hooku PreToolUse, nieprzypięte launchery w hookach, potem pluginy i marketplace'y (`enabledPlugins`, `extraKnownMarketplaces`, `plugin.json`, `gemini-extension.json`), `headersHelper`, Gemini `context.fileName` | S + S + M–L |
| 14 | Łatwiejsze wdrożenie: krótki start w README, tryb baseline (obecne znaleziska jako wyjątki z `until`), podsumowanie w PR z GitHub Action (`GITHUB_STEP_SUMMARY`), pre-commit, presety polityki | S każde |
| 15 | Baza wiedzy łatwiejsza w utrzymaniu: cotygodniowy automat poza CLI, który sprawdza zmiany źródeł i zakłada zgłoszenia; `doctor` zgłasza nieznane pliki w znanych folderach agentów; CONTRIBUTING z formularzem „korekta faktu ze źródłem” | M |
| 16 | Polityka dla organizacji w MIT: `extends` z lokalnej ścieżki lub `node_modules`, zakres „managed”, lista dozwolonych skilli i serwerów po sumie kontrolnej (zalążek rejestru) | M |
| później | Hooki dla kolejnych agentów (Cursor, Codex, Gemini, jeśli ich hooki pozwalają odmówić), bezpieczne `fix` dla przypadków mechanicznych, ustawienia uruchamiające polecenia u innych agentów | M na agenta |

Czego nie robić w MIT: oceny tekstu przez LLM, własnej bazy złośliwych skilli, sieci w skanerze, „wyniku bezpieczeństwa” w procentach, rozszerzenia do IDE w najbliższym czasie, scalania depcurfew i agentcurfew w jedną paczkę.

Rodzina z depcurfew: dwie osobne paczki o wspólnym wyglądzie i wzajemnych odnośnikach. Prośby do sesji depcurfew są w `docs/handoff-depcurfew.md`; przekazuje je Pan.
