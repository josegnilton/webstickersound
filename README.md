# FigSom

Sobe um vídeo e ele vira uma figurinha com som para o WhatsApp.

Roda só no seu computador: abre uma página em `http://127.0.0.1:4827`. Não tem conta, servidor externo nem custo.

## Como usar

1. Dê dois cliques em `Abrir FigSom.cmd`. A página abre no navegador.
2. Arraste um vídeo (MP4, MOV, WebM, MKV, AVI ou GIF). A figurinha é gerada na hora.
3. Ajuste o início, a duração (até 10 s) e o enquadramento. Clique na figurinha para ouvir.
4. Clique em **Conectar WhatsApp** e leia o QR Code em WhatsApp > Aparelhos conectados.
5. Clique em **Enviar para o meu WhatsApp**. A figurinha chega na sua conversa com você mesmo. Salve nos favoritos e encaminhe.

Para encerrar, feche a janela minimizada "FigSom".

## Requisitos

- Node.js 20 ou mais novo.
- FFmpeg: `winget install Gyan.FFmpeg`.

## Testes

```
npm test
```

Cobre a conversão com FFmpeg, os metadados do WebP e os bytes da mensagem de figurinha com som. O envio real para o WhatsApp só dá para testar com uma conta conectada.

## Avisos

- O envio usa a biblioteca não oficial Baileys. O WhatsApp pode bloquear contas que usam clientes não oficiais.
- A pasta `data/session` dá acesso à sua conta do WhatsApp. Não compartilhe. O botão **Desconectar** apaga essa pasta.
- O formato da figurinha com som não é documentado pelo WhatsApp e pode mudar. Quem recebe só ouve o som se o WhatsApp dela já tiver o recurso.

## Créditos

O formato da mensagem de figurinha com som segue o descoberto pelo projeto [Figaudio](https://github.com/pandaNinja9714/Figaudio) (Apache-2.0).
