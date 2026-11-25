# Como contribuir

Contribuições são bem-vindas: correções, melhorias na página, suporte a outros formatos, traduções, o que fizer sentido. É um projeto feito por diversão, então não há prazo nem garantia de que tudo será aceito.

## Para mandar uma mudança

1. Faça um **fork** do repositório (botão **Fork** no GitHub).
2. Crie um branch para a sua mudança:

   ```bash
   git checkout -b minha-melhoria
   ```

3. Rode o projeto seguindo o [README](README.md) e faça a sua alteração.
4. Rode os testes:

   ```bash
   npm test
   ```

5. Faça o commit, envie o branch para o seu fork e abra um **Pull Request** para o branch `main` deste repositório, explicando o que mudou e como você testou.

Se a ideia for grande, abra uma **Issue** antes para conversar sobre ela.

## Combinados

- Mantenha o projeto simples: sem framework nem etapa de build na página (`web/` é HTML, CSS e JavaScript puros).
- Não envie nada da pasta `data/`. Ela guarda a sessão do WhatsApp e já está no `.gitignore`.
- Não adicione nada que mande mensagens para outras pessoas automaticamente ou em massa. O projeto envia só para a conversa da própria pessoa, de propósito.
- Ao adicionar uma dependência, fixe a versão exata no `package.json`.
- Textos da página e do README em português do Brasil, simples e sem jargão.

Ao enviar um Pull Request, você concorda que a sua contribuição fica sob a mesma [licença](LICENSE) do projeto (Apache-2.0).
