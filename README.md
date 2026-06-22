# Strava Training Log

App web simples com login Strava OAuth, lista de atividades recentes e botao
para marcar treinos como analisados.

## Como usar

1. Cria uma app em https://www.strava.com/settings/api.
2. Define o callback domain como `localhost`.
3. Copia `.env.example` para `.env` e preenche `STRAVA_CLIENT_ID` e
   `STRAVA_CLIENT_SECRET`.
4. Inicia a app:

```bash
npm start
```

5. Abre http://localhost:3000 e entra com Strava.

O estado "analisado" fica guardado no `localStorage` do browser. A sessao OAuth
fica em memoria no servidor local, por isso reiniciar o servidor exige novo
login.
