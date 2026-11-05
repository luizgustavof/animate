# Plano: ElevenLabs via API no `tts.py`

**Status:** Fase 1 implementada e testada contra um servidor fake (falta 1 teste com a chave real) · Fase 2 pendente · 2026-11-05

## Objetivo

Gerar as falas do voice-over com o ElevenLabs direto pela API, sem depender do conector MCP do Claude. Assim qualquer agente (Claude, Codex, Cursor, CI) consegue rodar.

## Decisões

- **Kokoro continua.** Ele segue como engine padrão, local e grátis. O ElevenLabs entra como mais um engine, opcional, em `plugins/animate/skills/animate/tools/tts.py`, ao lado de `kokoro`, `chatterbox`, `piper` e `file`.
- **Cada voz escolhe seu engine** no `script.json`. Dá pra misturar no mesmo script: narrador ElevenLabs, robô Piper, figurante Kokoro.
- **Nada de arquivo novo (`tts.mjs`).** O `tts.py` já tem cache por hash, `fx`, `room`, `wow`, `lufs` e saída a 48 kHz. O ElevenLabs herda tudo isso sem código extra.
- **Conector MCP e gravação própria continuam funcionando.** O conector vira a 3ª opção na SKILL.md.
- **Sem dependência nova:** a chamada HTTP usa só a stdlib (`urllib`).

## Fase 1 — engine `elevenlabs` (núcleo)

### 1. Função `elevenlabs(text, V, out)` em `tts.py`

Formato da voz no `script.json`:

```json
"voices": {
  "narrator": {
    "engine": "elevenlabs",
    "voice_id": "<id da voz>",
    "model": "eleven_multilingual_v2",
    "stability": 0.5,
    "similarity": 0.75,
    "style": 0,
    "speed": 1.0,
    "seed": 42,
    "lang": "pt",
    "fx": "<cadeia -af opcional>",
    "lufs": -18
  }
}
```

- Chamada: `POST /v1/text-to-speech/{voice_id}` com `model_id`, `voice_settings` (`stability`, `similarity_boost`, `style`, `use_speaker_boost`, `speed`), `seed` e `language_code`.
- **Chave:** lida da env var `ELEVENLABS_API_KEY`. Nunca é gravada em arquivo do repo nem impressa no log.
- **`seed` fixo** → re-take reproduzível.
- **`previous_text` / `next_text`** = texto das falas vizinhas → a entonação flui entre as falas. Essas falas ficam **fora do hash**: editar a fala vizinha não refaz (nem cobra) esta.
- **Formato de saída:** pede `pcm_24000`, que vem sem perda. Se o plano da conta não permitir, cai pra `mp3_44100_128`. Depois o fluxo é o de sempre: `room` → `fx` → `wow` → `lufs` → 48 kHz.
- Os campos que uma fala pode sobrescrever ganham `stability`, `style` e `seed`.

### 2. Proteção de créditos

- **Hash existente** (`<id>.wav.json`) → fala inalterada não é cobrada de novo.
- **`--dry-run`** → lista as falas que seriam geradas e o total de caracteres, sem chamar a API.
- **`"takes": N` + SQUIM bloqueado** no ElevenLabs (custaria N vezes). Mostra um aviso e usa 1 take.
- O resumo final mostra quantos caracteres foram gastos na execução.

### 3. Erros claros

| Resposta | Mensagem / ação |
|---|---|
| 401 | Chave ausente ou inválida → explica como definir `ELEVENLABS_API_KEY` |
| `quota_exceeded` | Créditos acabaram → para e informa quais falas ficaram faltando |
| 429 / 5xx | Retry com backoff (3 tentativas) |
| Formato não permitido no plano | Cai pra mp3 automaticamente |

### 4. `--voices`

`python tools/tts.py --voices` → lista as vozes da conta (`GET /v1/voices`): nome, `voice_id`, idioma/sotaque e categoria. Serve pra escolher o `voice_id` sem abrir o site.

### 5. Documentação

- Docstring do `tts.py`: engine novo, campos e custo.
- Comentário no topo do `voice.mjs`: as takes podem vir do engine `elevenlabs`.
- `SKILL.md` (seção Voice-over): API como caminho principal pro ElevenLabs e conector como alternativa. Mantém o fluxo de "2–3 vozes candidatas, 1 fala cada, usuário escolhe".
- `intake.md` e `README.md`: requisito opcional `ELEVENLABS_API_KEY`.

## Fase 2 — timing sem whisper (opcional)

- Usar `/v1/text-to-speech/{voice_id}/with-timestamps` e salvar o alinhamento por caractere em `<id>.wav.json`.
- O `voice.mjs` usaria esse alinhamento no lugar do faster-whisper, **só quando for válido**:
  - nenhum efeito que mexa no tempo (`asetrate`, `atempo`, `wow`, `pause`);
  - corrigir o offset do trim de silêncio do `decode()`.
- Em qualquer outro caso, volta pro whisper (comportamento atual).
- **Ganho menor do que parece:** o whisper já roda local e com cache (`.heard.json`). Por isso fica separado da Fase 1.

## Testes

1. **Sem gastar nada:** `--dry-run` + uma chamada fake (servidor local ou mock do `urllib`) → confere o corpo da requisição, o tratamento de erros e o fallback de formato.
2. **Real, mínimo:** 1 fala curta com a chave do usuário (poucos caracteres) → WAV a 48 kHz, `fx`/`lufs` aplicados, e a 2ª execução não chama a API (cache).
3. **Kokoro intacto:** rodar o `tts.py` num script existente → nenhuma take refeita (hash igual = nada quebrou).
4. `voice.mjs` em seguida → `voice.json` gerado normalmente com as takes do ElevenLabs.

## Fora do escopo

- Clonagem de voz (só vozes que o usuário tem direito de usar, já existentes na conta).
- `previous_request_ids` / request stitching.
- Trocar o default do Kokoro.
