# DJ SALVA: R2 + Workers

Estado: activado en Cloudflare el 10 de octubre de 2026. Los diez originales estan
en el bucket privado `djsalva-media` (Standard, WEUR). La configuracion de la web
utiliza `https://djsalva-media.salva00000001.workers.dev` y la cache PWA v25.
La web permanece en `https://djsalva.vercel.app`; solo cambian sus medios.
No se incluye el tercer audio de la sesion 04. No hay contrasenas ni claves en el
repositorio. Se conservan los originales y el almacenamiento anterior.

## Requisitos y coste

- Cuenta Cloudflare con R2 activado y metodo de pago validado cuando lo solicite.
- R2 **Standard** incluye 10 GB-mes, 1 millon de operaciones A y 10 millones B
  al mes. La salida de datos de R2 es gratuita. Superar almacenamiento u
  operaciones incluidos puede generar cargos; esto no es un limite de gasto.
- Workers **Free** admite 100.000 peticiones al dia; al agotarlas deja de servir
  peticiones hasta el reinicio diario. Una escucha puede hacer varias peticiones.
- Cada GET de este Worker consulta metadatos y luego el rango: normalmente dos
  operaciones B de R2. HEAD y las respuestas 304 solo consultan metadatos.
- No activar Workers Paid, Stream, Infrequent Access ni otros extras para este
  montaje. Revisar periodicamente las metricas de R2 y Workers.
- `workers.dev` no requiere comprar dominio. Cloudflare recomienda dominio
  propio para produccion; el subdominio esta orientado a proyectos personales
  no criticos. No se promete disponibilidad ilimitada ni coste cero garantizado.
- Node.js 22 o superior y npm para los comandos siguientes.

Fuentes: [R2](https://developers.cloudflare.com/r2/pricing/),
[Workers](https://developers.cloudflare.com/workers/platform/limits/),
[workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Preparar la cuenta

Desde esta carpeta:

```sh
npm ci
npm run login
npx wrangler whoami
```

El login abre Cloudflare en el navegador. No pegar tokens en el chat ni guardarlos
en este proyecto. Si hay varias cuentas, seleccionar la correcta con
`CLOUDFLARE_ACCOUNT_ID` antes de crear o subir recursos.

Activar R2 en el panel solo despues de revisar las condiciones de facturacion.
Crear un bucket **Standard** llamado `djsalva-media`, preferiblemente en Europa:

El bucket de este proyecto ya existe. No repetir su creacion para actualizar medios.

```sh
npx wrangler r2 bucket create djsalva-media --location weur
```

No hace falta habilitar acceso publico `r2.dev`: el bucket queda privado y el
Worker recibe un binding directo. No introducir claves de R2 en el HTML.

## Verificar y subir los originales

Se conserva la ruta `audio/sesionXX.mp4` de los videos y los MP3 van en la raiz.
El script comprueba nombre, tamano y SHA-256 de **todos** los originales antes de
subir el primero. El inventario identifica los archivos proporcionados por el
usuario; no contiene rutas privadas del ordenador.

```sh
node scripts/upload.mjs "$HOME/Desktop"
node scripts/upload.mjs "$HOME/Desktop" --upload
```

`--upload` hace escrituras remotas y requiere R2 activado. No borra Vercel ni
modifica la web. Una repeticion sobrescribe los mismos diez objetos, no crea
duplicados; si cambian los originales hay que revisar el inventario primero.

## Desplegar y comprobar

```sh
npm test
npx wrangler deploy --dry-run
npm run deploy
```

Usar la URL **real** que devuelva el despliegue, por ejemplo una con el formato
`https://djsalva-media.TU_SUBDOMINIO.workers.dev`, nunca publicar el ejemplo.

```sh
node scripts/activate.mjs https://djsalva-media.salva00000001.workers.dev
```

Se verifica salud, tamano, MIME, CORS y GET parcial del principio y del final de
cada archivo. Solo lee 34 bytes de contenido por archivo, sin descargar sesiones
completas. Esta comprobacion se puede repetir despues de activar la migracion.
La salud por si sola no verifica que los objetos existan.

## Activar en la web

La migracion inicial ya esta aplicada. El comando siguiente se documenta para
una copia anterior que aun utilice Blob; rechaza activarla dos veces. Solo
ejecutarlo despues de que todas las comprobaciones pasen:

```sh
node scripts/activate.mjs https://djsalva-media.salva00000001.workers.dev --activate
```

El script sustituye las diez URLs en `index.html` y aumenta la version del service
worker. No cambia imagenes, temas, listas, tiempos ni la URL `djsalva.vercel.app`.
Probar play, pausa, saltos de canciones y transicion entre partes de 03/04 en
Safari/WebKit y Chromium antes de publicar estos dos archivos en GitHub/Vercel.
No borrar los originales ni el almacenamiento anterior hasta validar produccion.

## Seguridad y reproduccion

- Solo lectura (GET, HEAD y OPTIONS) para los diez nombres permitidos; no hay
  rutas publicas para subir, borrar ni listar objetos.
- Byte ranges 206, sufijos, If-Range, ETag/304 y errores 416 para Safari y PWA.
- El cuerpo se transmite como stream, sin cargar audios largos enteros en RAM.
- Cache del navegador de una hora, sin transformaciones de audio o video.
- CORS permite la web de produccion. Para pruebas locales se puede configurar
  `ALLOWED_ORIGINS` con origenes adicionales separados por comas. No es DRM ni
  impide descargar archivos publicos: una peticion sin Origin sigue permitida.
- El Worker no usa un proxy de Vercel: el contenido viaja de Cloudflare al
  navegador y no consume Blob Data Transfer en Vercel.
- El sitio estatico excluye esta carpeta mediante `.vercelignore`.

## Comprobaciones realizadas (10 de octubre de 2026)

- 23 pruebas automaticas, incluyendo el runtime real de Workers con
  R2 emulado y las pruebas existentes de la sesion 04.
- Compilacion `wrangler deploy --dry-run` correcta; no despliega ni crea recursos.
- Diez originales verificados: 763.272.579 bytes en total.
- Prueba local con los diez originales, R2 emulado y la web: Chromium y WebKit
  reprodujeron audio y video de las cuatro sesiones, saltaron entre canciones
  y pasaron automaticamente entre las partes de las sesiones 03 y 04.
- No se accedio a Vercel Blob durante esas pruebas. Se bloquearon las peticiones
  externas del navegador. No equivale a una prueba en Cloudflare en produccion
  ni a una comprobacion en un iPhone fisico.
- Cuenta autorizada por OAuth, bucket Standard creado y diez originales subidos.
- Worker desplegado: `875fcf82-994d-483a-8117-d1fe9e12e62a`.
- Verificacion remota correcta: diez HEAD y veinte rangos GET, MIME y CORS.
- Antes de publicar, Chromium y WebKit reproducen los medios reales de Cloudflare
  en las cuatro sesiones; verifican saltos de canciones y el paso automatico entre
  las partes de 03/04 con tiempo acumulado. No es una prueba en un iPhone fisico.
