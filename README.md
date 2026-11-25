# Figuráudio

Transforma um trecho de vídeo em **figurinha com som** e envia para o **seu próprio WhatsApp**.

Roda no seu computador. Cada pessoa usa a própria conta: você conecta o seu WhatsApp lendo um QR Code, igual ao WhatsApp Web, e a figurinha chega na sua conversa com você mesmo. De lá você salva nos favoritos e manda para quem quiser.

- Grátis e open source.
- Sem conta, sem servidor de terceiros: o vídeo não sai do seu computador.
- Funciona no Windows, macOS e Linux.

> **Aviso:** o envio usa a [Baileys](https://github.com/WhiskeySockets/Baileys), uma biblioteca **não oficial** do WhatsApp. O WhatsApp pode bloquear contas que usam clientes não oficiais. Use por sua conta e risco, de preferência sem mandar muitas figurinhas seguidas.

---

## Passo a passo

### 1. Instale o Node.js e o FFmpeg (só na primeira vez)

Você precisa de dois programas gratuitos:

- **Node.js 20 ou mais novo**: roda o Figuráudio.
- **FFmpeg**: converte o vídeo.

**Windows** (no PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

**macOS** (com [Homebrew](https://brew.sh)):

```bash
brew install node ffmpeg
```

**Linux** (Debian/Ubuntu):

```bash
sudo apt install nodejs npm ffmpeg
```

Depois de instalar, **feche e abra o terminal de novo** para ele encontrar os programas. Para conferir:

```bash
node --version
ffmpeg -version
```

### 2. Baixe o Figuráudio

Com Git:

```bash
git clone https://github.com/josegnilton/webstickersound.git figuraudio
cd figuraudio
```

Ou, no GitHub, clique em **Code > Download ZIP** e extraia a pasta.

### 3. Instale as dependências (só na primeira vez)

Dentro da pasta do projeto:

```bash
npm install
```

### 4. Abra o Figuráudio

```bash
npm start
```

A página abre sozinha no navegador, em `http://127.0.0.1:4827`. Se não abrir, copie esse endereço no navegador.

No Windows, também dá para dar dois cliques em **`Abrir Figuraudio.cmd`**. Ele faz o passo 3 sozinho na primeira vez.

Deixe a janela do terminal aberta enquanto usa. Para encerrar, feche a janela ou aperte `Ctrl+C`.

### 5. Conecte o seu WhatsApp

1. Na página, clique em **Conectar o WhatsApp**.
2. No celular, abra o WhatsApp e vá em **Aparelhos conectados > Conectar aparelho**.
3. Leia o QR Code que aparece na tela.

Pronto: o topo da página mostra **WhatsApp conectado**. A conexão fica salva no seu computador, então você só faz isso uma vez.

### 6. Faça a figurinha

1. **Escolha o vídeo**: clique em **Escolher vídeo** ou arraste o arquivo para a página.
2. **Escolha o trecho**: arraste a seleção na barra (até 10 segundos) ou digite o início e a duração. **Ouvir trecho** toca o pedaço escolhido.
3. **Enquadramento**: **Preencher** corta o vídeo num quadrado; **Mostrar tudo** mostra o vídeo inteiro com bordas transparentes.
4. **Confira**: a figurinha aparece à direita. Toque nela para ouvir o som.
5. **Envie**: clique em **Enviar para o meu WhatsApp**.

A figurinha chega na sua conversa com você mesmo (a conversa com o seu próprio número). Toque nela, salve nos favoritos e encaminhe para quem quiser.

Também dá para baixar a figurinha (`.webp`) e o som (`.ogg`) separados pelos links da página.

---

## Problemas comuns

| O que aparece | O que fazer |
| --- | --- |
| **"FFmpeg não foi encontrado"** | Instale o FFmpeg (passo 1), feche o terminal, abra de novo e rode `npm start`. |
| **O celular diz "sem conexão" ao ler o QR Code** | Confira a internet do computador e do celular, feche o QR e clique em **Conectar o WhatsApp** de novo. |
| **"A porta 4827 já está em uso"** | O Figuráudio já está aberto em outra janela. Use `http://127.0.0.1:4827` ou feche a outra janela. Para usar outra porta: `PORT=5000 npm start` (no PowerShell: `$env:PORT=5000; npm start`). |
| **"Esse vídeo não tem som"** | O vídeo não tem faixa de áudio. A figurinha é criada, mas sai muda e não pode ser enviada com som. |
| **"A figurinha passou de 500 KB"** | O WhatsApp limita figurinhas animadas a 500 KB. Escolha um trecho mais curto. |
| **A figurinha chegou, mas quem recebeu não ouve o som** | A figurinha com som é um recurso novo do WhatsApp, liberado aos poucos. Quem recebe precisa ter o WhatsApp atualizado. |
| **Quero trocar de conta ou desconectar** | Clique em **Desconectar o WhatsApp** na página. Você também pode remover o aparelho no celular, em **Aparelhos conectados**. |

---

## Onde ficam os arquivos

Tudo fica na pasta `data/`, dentro do projeto:

- `data/session/`: a conexão com o seu WhatsApp. **Quem tiver essa pasta consegue usar a sua conta.** Não compartilhe e não envie para o GitHub (ela já está no `.gitignore`). O botão **Desconectar** apaga essa pasta.
- `data/work/`: o último vídeo e a última figurinha. É apagada a cada vídeo novo.
- `data/whatsapp.log`: registro da conexão, útil se algo der errado.

---

## Como funciona

1. A página envia o vídeo para o servidor local (que roda só no seu computador, em `127.0.0.1`).
2. O FFmpeg corta o trecho, enquadra em 512x512 e gera:
   - a figurinha animada em **WebP**, com até 500 KB;
   - o som em **Opus** (`.ogg`), o mesmo formato dos áudios do WhatsApp.
3. Ao enviar, a Baileys conecta como um "aparelho conectado" e manda uma mensagem de figurinha com o áudio embutido para a sua própria conversa.

O formato da figurinha com som não é documentado pelo WhatsApp e pode mudar a qualquer momento.

### Estrutura do código

```
server/
  index.js          servidor local e rotas da página
  media.js          monta a figurinha e o som a partir do vídeo
  recipe.js         comandos exatos do FFmpeg
  ffmpeg.js         encontra e executa o FFmpeg
  webp.js           escreve nome do pacote e autor no WebP
  whatsapp.js       conexão com o WhatsApp (Baileys)
  sound-sticker.js  formato da mensagem de figurinha com som
web/                a página (HTML, CSS e JavaScript, sem build)
test/               testes (npm test)
```

### Testes

```bash
npm test
```

Testa a conversão com o FFmpeg (quando instalado), os metadados do WebP e os bytes da mensagem. O envio real só dá para testar com uma conta conectada.

---

## Créditos

- O formato da mensagem de figurinha com som foi baseado no [Figaudio](https://github.com/pandaNinja9714/Figaudio) (Apache-2.0).
- [Baileys](https://github.com/WhiskeySockets/Baileys): conexão com o WhatsApp.
- [FFmpeg](https://ffmpeg.org): conversão de vídeo e áudio.

## Licença

[Apache-2.0](LICENSE). Este projeto não tem relação com o WhatsApp nem com a Meta.
