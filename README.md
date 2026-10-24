# synthuniverse

Site synthwave em HTML, CSS e JavaScript puros, sem bibliotecas e sem etapa de build.

1. **Retrato.** Uma mulher de pele azulada, desenhada em traço de nanquim, sorri, pisca e olha para você.
2. **Cosmos.** Ao clicar em "Entrar no universo", ela se dissolve em estrelas e surge uma paisagem synthwave com sol listrado, montanhas e grade neon.
3. **Universo infinito.** A câmera decola e a viagem segue sem fim por regiões geradas na hora. A cada região mudam a paleta, o cenário, os objetos e a harmonia da trilha. A viagem só para no botão **Reiniciar**.

A trilha sonora é sintetizada em tempo real com a Web Audio API e sincronizada com as animações.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Estrutura, retrato em SVG e HUD |
| `style.css` | Tema, retrato, transições, HUD e responsividade |
| `script.js` | Som, animação do retrato, canvas, universo infinito e cenas |
| `docs/COMO-FUNCIONA.md` | Documentação completa da arquitetura |

## Como rodar

Abra `index.html` no navegador. Para servir localmente:

```bash
npx serve .
# ou
python3 -m http.server
```

## Trocar a música

No início de `script.js`:

```js
const CONFIG = { musicUrl: 'musica.mp3' };
```

Coloque o arquivo de áudio na mesma pasta. Deixe a string vazia para usar a trilha sintetizada. O visitante também pode carregar uma música pelo botão **Sua música**. Os navegadores só tocam áudio depois de um clique, por isso o som começa na primeira interação.

## Documentação

Para entender como tudo funciona (máquina de cenas, motor de som, renderização, regiões do universo infinito) e onde ajustar cada valor, leia [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md).
