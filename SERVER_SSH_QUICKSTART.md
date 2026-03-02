# Spacehamsters backend – rychlý přístup po přihlášení (SSH)

## 1) Přihlášení na server

```bash
ssh mitelin@spacehamsters.eu
```

## 2) Přechod do projektu

```bash
cd /home/spacehamsters-backend
```

## 3) Aktivace Python prostředí (venv)

```bash
source .venv/bin/activate
```

Pokud používáš virtualenvwrapper a funguje ti to, můžeš místo toho použít:

```bash
workon spacehamsters311
```

## 4) Kontrola, že jsi ve správném Pythonu

```bash
which python
python --version
```

Správně má ukazovat něco jako:

```
/home/spacehamsters-backend/.venv/bin/python
```

## 5) Užitečné příkazy

Stav backendu na portu 8010:

```bash
ss -ltnp | grep 8010
```

Živé logy:

```bash
tail -f logs/backend.out.log logs/backend.err.log
```

Ruční spuštění launcheru:

```bash
./.venv/bin/python launcher.py --config launcher_config.json
```

Vynucený update z gitu:

```bash
./.venv/bin/python launcher.py --config launcher_config.json --force-update
```

Vynucený restart backendu:

```bash
./.venv/bin/python launcher.py --config launcher_config.json --force-restart
```
