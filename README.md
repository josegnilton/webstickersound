# Figuráudio

Transforma um trecho de vídeo em **figurinha com som** (ou uma foto em figurinha comum) e envia para o **seu próprio WhatsApp**.

Roda no seu computador. Cada pessoa usa a própria conta: você conecta o seu WhatsApp lendo um QR Code, igual ao WhatsApp Web, e a figurinha chega na sua conversa com você mesmo. De lá você salva nos favoritos e manda para quem quiser.

- Grátis e open source.
- Sem conta, sem servidor de terceiros: o vídeo não sai do seu computador.
- Funciona no Windows, macOS e Linux.

> **Leia antes de usar**
>
> Fiz este projeto para me divertir com os amigos. Não é um produto, não tem suporte e pode parar de funcionar a qualquer momento.
>
> Antes de rodar, analise o que ele vai fazer: leia o código, entenda as dependências e decida se você confia nelas. Ele conecta na sua conta do WhatsApp e guarda essa conexão no seu computador.
>
> O envio usa a [Baileys](https://github.com/WhiskeySockets/Baileys), uma biblioteca **não oficial** do WhatsApp. Para uso pessoal, como mandar algumas figurinhas para você mesmo, o risco na prática é baixo, **contanto que você não faça flood** (muitas mensagens em sequência). Mas o risco não é zero: clientes não oficiais vão contra os Termos do WhatsApp, e a conta pode ser bloqueada.
>
> **Use por sua conta e risco. Não me responsabilizo por nada que aconteça com a sua conta, o seu computador ou os seus dados.** O software é fornecido "como está", sem garantia de nenhum tipo (veja a [licença](LICENSE)).

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
sudo apt install ffmpeg
```

O Node.js do `apt` costuma ser antigo demais. Instale a versão LTS pelo site oficial, [nodejs.org](https://nodejs.org), ou pelo gerenciador que você já usa.

Depois de instalar, **feche e abra o terminal de novo** para ele encontrar os programas. Para conferir:

```bash
node --version
ffmpeg -version
```

O `node --version` precisa mostrar `v20` ou mais.

### 2. Baixe o Figuráudio

Com Git:

```bash
git clone https://github.com/josegnilton/webstickersound.git figuraudio
cd figuraudio
```

Ou, no GitHub, clique em **Code > Download ZIP** e extraia a pasta.

Coloque a pasta dentro da sua pasta de usuário (por exemplo, `Documentos`), e **não** numa pasta sincronizada com a nuvem (OneDrive, Google Drive, Dropbox) nem numa pasta compartilhada com outras pessoas: é ali que fica salva a conexão com o seu WhatsApp.

### 3. Instale as dependências (só na primeira vez)

Dentro da pasta do projeto:

```bash
npm ci
```

O `npm ci` instala exatamente as versões registradas no projeto.

### 4. Abra o Figuráudio

```bash
npm start
```

A página abre sozinha no navegador, em `http://127.0.0.1:4827`. Se não abrir, copie esse endereço no navegador.

No Windows, também dá para dar dois cliques em **`Abrir Figuraudio.cmd`**. Ele faz o passo 3 sozinho na primeira vez e abre uma janela preta: deixe ela aberta enquanto usa.

Deixe a janela do terminal aberta enquanto usa. Para encerrar, feche a janela ou aperte `Ctrl+C`.

### 5. Conecte o seu WhatsApp

1. Na página, clique em **Conectar o WhatsApp**.
2. No celular, abra o WhatsApp e vá em **Aparelhos conectados > Conectar aparelho**.
3. Leia o QR Code que aparece na tela.

Se o código expirar ou o celular não conseguir conectar, clique em **Gerar novo QR Code** e leia de novo.

Pronto: o topo da página mostra **WhatsApp conectado**. A conexão fica salva no seu computador, então você só faz isso uma vez.

### 6. Faça a figurinha

No topo da página, escolha o tipo de figurinha:

| Tipo | O que faz |
| --- | --- |
| **Vídeo** | Figurinha animada com o som do próprio vídeo. Se o vídeo não tiver som, ela vai como figurinha animada muda. |
| **Vídeo + áudio** | Figurinha animada com o som de outro arquivo (MP3, M4A, AAC, OGG, Opus, WAV, FLAC ou outro vídeo) no lugar do som do vídeo. |
| **Foto** | Figurinha comum, parada e sem som (JPG, PNG, WebP, GIF ou BMP). |

Depois:

1. **Escolha o arquivo**: clique em **Escolher vídeo** (ou **Escolher foto**) ou arraste o arquivo para a página. Arrastar já escolhe o tipo: uma foto vai para **Foto**, e um vídeo junto com um áudio vai para **Vídeo + áudio**.
2. **Escolha o trecho** (vídeo): arraste a seleção na barra (até 10 segundos) ou digite o início e a duração. **Ouvir trecho** toca o pedaço escolhido.
3. **Escolha o áudio** (Vídeo + áudio): clique em **Escolher áudio** e arraste a seleção na barra do áudio para escolher a parte que toca.
4. **Enquadramento**: **Preencher** corta num quadrado; **Mostrar tudo** mostra a imagem inteira com bordas transparentes.
5. **Confira**: a figurinha aparece à direita. Se tiver som, toque nela para ouvir.
6. **Envie**: clique em **Enviar para o meu WhatsApp**.

A figurinha chega na sua conversa com você mesmo (a conversa com o seu próprio número). Toque nela, salve nos favoritos e encaminhe para quem quiser.

Também dá para baixar a figurinha (`.webp`) e o som (`.ogg`) separados pelos links da página.

---

## Problemas comuns

| O que aparece | O que fazer |
| --- | --- |
| **"FFmpeg não foi encontrado"** | Instale o FFmpeg (passo 1), feche o terminal, abra de novo e rode `npm start`. |
| **"O FFmpeg instalado não tem libwebp_anim" (ou libopus)** | Sua versão do FFmpeg é incompleta. Instale a versão completa pelos comandos do passo 1. |
| **`npm ci` falha dizendo que precisa do Node.js 20** | Seu Node.js é antigo. Instale a versão LTS em [nodejs.org](https://nodejs.org). |
| **O celular diz "sem conexão" ao ler o QR Code** | Confira a internet do computador e do celular, clique em **Gerar novo QR Code** e leia o código novo. |
| **"A porta 4827 já está em uso"** | O Figuráudio já está aberto em outra janela. Use `http://127.0.0.1:4827` ou feche a outra janela. Para usar outra porta: `PORT=5000 npm start` (no PowerShell: `$env:PORT=5000; npm start`). |
| **"Esse vídeo não tem som"** | O vídeo não tem faixa de áudio. Ele vai como figurinha muda; para colocar um som, use **Vídeo + áudio**. |
| **"A figurinha passou de 500 KB"** | O WhatsApp limita figurinhas animadas a 500 KB. Escolha um trecho mais curto. |
| **"A figurinha passou de 100 KB"** | O WhatsApp limita figurinhas paradas a 100 KB. Tente outra foto. |
| **A figurinha chegou, mas quem recebeu não ouve o som** | A figurinha com som é um recurso novo do WhatsApp, liberado aos poucos. Quem recebe precisa ter o WhatsApp atualizado. |
| **Quero trocar de conta ou desconectar** | Clique em **Desconectar o WhatsApp** na página. Você também pode remover o aparelho no celular, em **Aparelhos conectados**. |

---

## Onde ficam os arquivos

Tudo fica na pasta `data/`, dentro do projeto:

- `data/session/`: a conexão com o seu WhatsApp. **Quem tiver essa pasta consegue usar a sua conta.** Não compartilhe e não envie para o GitHub (ela já está no `.gitignore`). O botão **Desconectar** apaga essa pasta.
- `data/work/`: o último vídeo ou foto, o áudio separado (se tiver) e a última figurinha. É apagada sempre que o Figuráudio abre.
- `data/whatsapp.log`: registro de avisos e erros da conexão, útil se algo der errado. Os números e nomes dos contatos são retirados, mas mesmo assim **não publique esse arquivo**.

---

## Como funciona

1. A página envia o vídeo para o servidor local (que roda só no seu computador, em `127.0.0.1`).
2. O FFmpeg corta o trecho (e, se você escolheu um áudio separado, o pedaço do áudio no lugar do som do vídeo), enquadra em 512x512 e gera:
   - a figurinha animada em **WebP**, com até 500 KB;
   - o som em **Opus** (`.ogg`), o mesmo formato dos áudios do WhatsApp.

   Uma foto vira uma figurinha **WebP** parada, com até 100 KB.
3. Ao enviar, a Baileys conecta como um "aparelho conectado" e manda a figurinha (com o áudio embutido, se tiver som) para a sua própria conversa.

O formato da figurinha com som não é documentado pelo WhatsApp e pode mudar a qualquer momento.

### Estrutura do código

```
server/
  index.js          servidor local e rotas da página
  media.js          monta a figurinha (e o som) a partir do vídeo ou da foto
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

## Contribuir

Quer mudar alguma coisa? Faça um fork e abra um Pull Request. O passo a passo e os combinados estão em [CONTRIBUTING.md](CONTRIBUTING.md).

## Créditos

- [Baileys](https://github.com/WhiskeySockets/Baileys): conexão com o WhatsApp.
- [FFmpeg](https://ffmpeg.org): conversão de vídeo e áudio.

## Licença

[Apache-2.0](LICENSE). Este projeto não tem relação com o WhatsApp nem com a Meta.
