# Importar clientes do Excel (controlo mensal)

## Checklist antes de deploy / import

1. **Redeploy do Worker** (limite 500 → 3000 clientes):

```bash
cd worker
npx wrangler deploy
```

2. Confirme se o admin já tem clientes.  
   - Vazio ou pode descartar → Opção A  
   - Já tem dados a preservar → Opção B (fundir)
3. Use os JSON gerados nesta pasta.

## Ficheiros

| Ficheiro | Uso |
|----------|-----|
| `import-clients.json` | Relatório legível (contagens + lista completa) |
| `import-clients-payload.json` | Só `{ "clients": [...] }` para `replace_store` |
| `IMPORT.md` | Este guia |

### Critérios do import

| Regra | Detalhe |
|-------|---------|
| 1 registo por pessoa | Chave = Nº de sócio (`id: cli-{nº}`) |
| Activo vs expirado | Presente em **Nov ou Dez 2025** → `activo`; resto → `expirado` |
| Histórico | Cada mensalidade > 0 → entrada em `payments[]` |
| Devedores | Folhas DEVEDORES → `billingStatus: em_divida` |
| Pacote / preço | Mês mais recente com mensalidade válida |
| Telefone / email | Colunas OBS + email |

### Números (última geração)

- ~264 clientes únicos  
- ~255 com telefone  
- ~96 activos (folhas finais)  
- ~209 em dívida  
- ~239 com histórico de pagamentos  
- Pacotes limpos: só P.Bronze / P.Prata / P.Platina / P.Personalizado  

### Aviso — datas provisórias

O Excel termina em **Dezembro 2025**. O dia do import é posterior.  
Para os **activos**, `planEnd` é **provisório** (para o painel não marcar toda a gente como expirada):

- Em dia → `2026-12-04` (~30 dias a partir de 2026-11-04)
- Em dívida → `2026-11-11` (~7 dias, para aparecer nas alertas)

**A staff deve confirmar e usar Renovar** com as datas reais.

> **Cleanup 2026-11-05:** as notas `Import Excel (X meses) · planEnd provisório — confirmar/renovar no admin` foram removidas de todos os 264 clientes. Os campos estruturados (horário, cartão, idade) foram passados para `schedule` / `hasCard` / `age`. O `planEnd` provisório em si **mantém-se** até a staff renovar.

## Carregar no admin

### Opção A — substituir só `clients` (recomendado se o CRM pode ser sobrescrito)

O Worker **sem** `_forceReplace` troca apenas o array `clients` e **mantém** inscrições, contactos e newsletter.

```bash
# A partir da pasta buzios/
python3 - <<'PY'
import json, urllib.request
payload = json.load(open("import-clients-payload.json"))
body = json.dumps({
    "password": "buzios2026",
    "action": "replace_store",
    "data": payload
}).encode()
req = urllib.request.Request(
    "https://buzios-publish.gymngola.workers.dev/admin/data",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)
print(urllib.request.urlopen(req).read().decode()[:800])
PY
```

Altere a password se a de produção for outra.

**Não** envie `"_forceReplace": true` neste import — isso limparia também submissions e newsletters.

### Opção B — fundir (já existem clientes / inscrições)

`update_client` por cada registo (cria se o `id` não existir, actualiza se existir):

```bash
python3 - <<'PY'
import json, urllib.request, time
data = json.load(open("import-clients.json"))
password = "buzios2026"
ok = err = 0
for c in data["clients"]:
    body = json.dumps({
        "password": password,
        "action": "update_client",
        "data": c
    }).encode()
    req = urllib.request.Request(
        "https://buzios-publish.gymngola.workers.dev/admin/data",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req).read()
        ok += 1
    except Exception as e:
        err += 1
        print("fail", c["id"], e)
    time.sleep(0.05)
print("ok", ok, "err", err)
PY
```

## Depois do import

1. Hard-refresh **Admin → Clientes**
2. Filtrar Activos / Em dívida / Expirados e validar com a staff  
3. Corrigir telefones em falta (~9)  
4. **Renovar** activos com as datas de pagamento reais  
5. Manter o Excel como arquivo; o CRM fica para o dia-a-dia  

## Limite do store

Worker: máximo **3000** clientes (antes 500). Submissões continuam limitadas a 500.  
É obrigatório `npx wrangler deploy` a partir de `worker/` para o limite novo vigorar em produção.
