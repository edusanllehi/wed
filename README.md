# Berta i Edu · 15.05.27 · Menorca

Web de la boda en catalán, castellano e inglés, con RSVP que guarda las respuestas en una base de datos (Supabase) y se publica en Vercel.

- **Puesta en marcha:** [DEPLOY.md](DEPLOY.md). Ahí está todo lo que tenéis que hacer vosotros, paso a paso.
- **Resultados de las pruebas:** [TEST_REPORT.md](TEST_REPORT.md)

## Estructura

```
src/
  index.html          Página (diseño, estilos y contenido)
  app.js              Idiomas, formulario RSVP, copiar códigos/IBAN
  i18n/ca.json        Textos en catalán
  i18n/es.json        Textos en castellano
  i18n/en.json        Textos en inglés
  assets/             poster.jpg (save the date) y shoes.jpg (franja de las avarcas)
api/
  rsvp.js             POST /api/rsvp: valida y guarda la respuesta (servidor)
  keepalive.js        Lo llama Vercel 1 vez al día para que Supabase no se pause
supabase/migrations/
  20261012000000_rsvp.sql   Tablas, seguridad, función de guardado y vistas de exportación
scripts/
  build.mjs           Genera dist/ (lo que se publica). --preview: un único HTML de vista previa
  dev-server.mjs      Servidor local para probar
  export-csv.mjs      Descarga las respuestas a un CSV (npm run export:csv)
tests/                Pruebas automáticas (npm test)
vercel.json           Configuración de Vercel (build, cabeceras de seguridad, cron)
.env.example          Nombres de las variables de entorno (sin valores reales)
```

## Cambiar textos

Los textos están en `src/i18n/ca.json`, `es.json` y `en.json`: misma clave en los tres archivos. Al publicar, el build comprueba que ningún idioma se haya quedado sin una clave; si falta alguna, avisa y no publica.

Los textos que no cambian de idioma (nombres de hoteles, restaurantes, códigos de descuento, IBAN) están directamente en `src/index.html`.

## Cómo funciona el RSVP

1. El invitado rellena el formulario. El navegador valida los campos y avisa en su idioma.
2. Se envía a `/api/rsvp`, una función que corre en Vercel. Vuelve a validar y limpiar todo en el servidor y llama a Supabase con la clave secreta, que nunca llega al navegador.
3. En Supabase, la función `submit_rsvp` guarda la respuesta y sus invitados de una vez (todo o nada).
4. Solo cuando la base de datos confirma que lo ha guardado, el invitado ve el mensaje de "recibido".

Reglas:
- Enlace abierto: cualquiera con el link puede responder, por sí mismo o con su pareja (máximo 2 personas por respuesta).
- Un mismo nombre no puede responder dos veces, ni como titular ni como pareja. Si lo intenta, se le pide que os escriba.
- Los invitados no pueden editar su respuesta. Los cambios los hacéis vosotros desde Supabase (ver DEPLOY.md).
- Si se pierde la conexión o se pulsa dos veces, no se duplica nada: cada envío lleva un identificador único y reenviarlo devuelve el mismo resultado.
- Límite de abuso: como máximo 20 respuestas cada 10 minutos desde una misma conexión. La IP se guarda solo como hash anónimo.

## Idiomas

- Selector CA · ES · EN arriba a la derecha.
- Por defecto se usa el idioma del móvil o del ordenador; si no es catalán ni inglés, sale en castellano. La elección se recuerda.
- Enlaces directos por idioma: `/?lang=ca`, `/?lang=es`, `/?lang=en`.

## Comandos (solo si queréis tocar código)

```
npm install            # dependencias de pruebas
npm run dev            # web local en http://localhost:3000 (usa .env.local)
npm test               # todas las pruebas
npm run build          # genera dist/
npm run export:csv     # descarga respuestas (usa .env.local)
```
