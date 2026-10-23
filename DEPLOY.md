# Puesta en marcha

Todo lo que necesitáis hacer vosotros, en orden. Supabase y Vercel tienen plan gratuito y no hace falta tarjeta. Las claves secretas se pegan **solo** en Supabase y Vercel: nunca en un chat ni en un archivo que subáis.

Tiempo estimado: unos 30 minutos.

---

## 1. Base de datos (Supabase)

1. Entrad en <https://supabase.com>, cread una cuenta y pulsad **New project**.
   - Nombre: `boda-berta-edu`
   - Database password: generad una contraseña larga y guardadla en vuestro gestor de contraseñas. La web no la usa.
   - Region: **West EU (Ireland)** o **Central EU (Frankfurt)**
   - Plan: **Free**
2. Cuando el proyecto esté listo: menú izquierdo **SQL Editor** → **New query**.
3. Abrid `supabase/migrations/20261012000000_rsvp.sql`, copiad **todo** el contenido, pegadlo y pulsad **Run**. Tiene que salir *Success. No rows returned*.
4. Comprobad en **Table Editor** que aparecen `rsvp_responses` y `rsvp_guests`, las dos con la etiqueta de RLS activado.
5. Id a **Project Settings → API Keys** (o **API**) y apuntad en un lugar seguro:
   - **Project URL** (algo como `https://abcd1234.supabase.co`)
   - La **clave secreta**: `service_role` o, en proyectos nuevos, una que empieza por `sb_secret_`. **No** uséis la `anon`/`publishable`.

> Si volvéis a ejecutar el SQL más adelante, no se pierden datos.

## 2. Publicar la web (Vercel)

Necesitáis 4 variables de entorno:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | La Project URL del paso 1.5 |
| `SUPABASE_SERVICE_ROLE_KEY` | La clave secreta del paso 1.5 (marcadla como **Sensitive**) |
| `RSVP_HASH_SALT` | Una cadena aleatoria larga (40 caracteres o más, de un generador de contraseñas) |
| `CRON_SECRET` | Otra cadena aleatoria larga, distinta de la anterior |

Opcional, cuando tengáis dominio propio: `ALLOWED_ORIGINS` = `https://vuestrodominio.com,https://www.vuestrodominio.com`

### Opción A: desde vuestro ordenador, sin GitHub

Necesitáis tener Node.js 22 instalado (<https://nodejs.org>).

1. Descomprimid el .zip y abrid un terminal en la carpeta.
2. Ejecutad `npx vercel login` e iniciad sesión en el navegador que se abre.
3. Ejecutad `npx vercel` y aceptad las opciones por defecto. La configuración ya está en `vercel.json`, no hace falta cambiar nada.
4. En <https://vercel.com>, abrid el proyecto → **Settings → Environment Variables** y añadid las 4 variables para **Production** y **Preview**.
5. Ejecutad `npx vercel --prod`. Al terminar os da la URL pública (`https://…vercel.app`).

### Opción B: con GitHub

1. Cread un repositorio **privado** y subid la carpeta. El `.gitignore` ya excluye los secretos.
2. En Vercel: **Add New → Project → Import** el repositorio → **Deploy**.
3. Añadid las 4 variables en **Settings → Environment Variables** y pulsad **Deployments → … → Redeploy**.

## 3. Prueba en la web publicada (5 minutos)

1. Abrid la URL de Vercel en el móvil y en el ordenador, y cambiad entre CA, ES y EN.
2. Enviad un RSVP de prueba con el nombre `PRUEBA BORRAR`. Tiene que salir el mensaje de confirmación.
3. En Supabase → **Table Editor → rsvp_guests**, comprobad que aparece la fila.
4. Borradla: **Table Editor → rsvp_responses**, seleccionad la fila de prueba → **Delete**. Su invitado se borra automáticamente.
5. En Vercel → **Settings → Cron Jobs**, comprobad que aparece `/api/keepalive` una vez al día.

Si en el paso 2 sale "Ahora mismo no podemos guardar tu respuesta", revisad que las variables estén bien escritas y que habéis hecho un nuevo deploy después de añadirlas.

## 4. Dominio propio (opcional)

Comprar un dominio cuesta dinero (unos 10–15 €/año); la decisión es vuestra.

1. Comprad el dominio en vuestro proveedor o en Vercel (**Domains → Buy**).
2. En Vercel → proyecto → **Settings → Domains** → añadid `vuestrodominio.com` y `www.vuestrodominio.com`.
3. Vercel os mostrará los registros DNS exactos que necesitáis (normalmente un registro **A** para el dominio y un **CNAME** para `www`). Copiadlos en el panel DNS de vuestro proveedor.
4. El certificado HTTPS se genera solo cuando los DNS se propagan (de minutos a unas horas). Vercel marca el dominio como **Valid Configuration**.
5. Opcional: añadid `ALLOWED_ORIGINS` con vuestro dominio y volved a desplegar. A partir de ahí el formulario solo acepta envíos desde vuestra web. Si seguís usando también la URL `.vercel.app`, incluidla en la lista.

## 5. Ver, cambiar y exportar respuestas

Todo desde el panel de Supabase; nadie más puede ver estos datos.

- **Ver la lista:** **Table Editor → `rsvp_export`** (una fila por invitado, en castellano). También desde **SQL Editor**: `select * from rsvp_export;`
- **Totales** (cuántos vienen, preboda, bus, restricciones): `select * from rsvp_totals;`
- **Exportar a CSV o Excel:** en **SQL Editor** ejecutad `select * from rsvp_export;` y usad **Export → CSV** encima de los resultados. Si tenéis el proyecto en el ordenador con un `.env.local` (ver `.env.example`), también podéis usar `npm run export:csv`.
- **Cambiar una respuesta** (alguien os escribe): **Table Editor**
  - `rsvp_guests`: nombre, dietas, detalle de alergias
  - `rsvp_responses`: si viene, preboda, transporte, mensaje

  Doble clic en la celda → editad → **Save**.
- **Dejar que alguien responda de nuevo:** borrad su fila en `rsvp_responses`. Se borran también sus invitados y ya puede volver a enviar el formulario.

Exportad el CSV de vez en cuando como copia propia: no contéis con copias de seguridad automáticas en el plan gratuito.

Supabase pausa los proyectos gratuitos con poca actividad durante 7 días. Para evitarlo, `/api/keepalive` hace una consulta diaria. Si alguna vez el proyecto aparece como *Paused*, entrad en el panel y pulsad **Restore**: los datos se conservan.

## 6. Pendiente antes de enviar el enlace

- [ ] Supabase creado y SQL ejecutado (paso 1)
- [ ] Vercel desplegado con las 4 variables (paso 2)
- [ ] Prueba real hecha y fila de prueba borrada (paso 3)
- [ ] **IBAN real y titulares** en `src/index.html` (ahora pone `ES00 0000…`). Buscad `PENDIENTE` en ese archivo.
- [ ] Revisar que el pin de salida de los buses es el correcto
- [ ] Revisar las estrellas de los hoteles (algunos son "turismo de interior", sin categoría oficial)
- [ ] Lugar y hora de la preboda cuando los tengáis (clave `tbc` en `src/i18n/*.json`, o pedídmelo)
- [ ] Dominio propio (opcional, paso 4)
