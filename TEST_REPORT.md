# Informe de pruebas · 12 de octubre de 2026

**Resultado: 38 pruebas automáticas, 38 superadas, 0 fallidas.** Se repiten con `npm test`.

## Cómo se ha probado

| Capa | Con qué |
|---|---|
| Base de datos | **Postgres real** (PGlite, en memoria) con el mismo SQL de `supabase/migrations/` y los roles de Supabase (`anon`, `authenticated`, `service_role`) |
| Servidor `/api/rsvp` | El código real de `api/rsvp.js`, con Supabase simulado para forzar fallos |
| De principio a fin | **Chromium real** → web compilada (`dist/`) → `/api/rsvp` → API REST que imita a Supabase → Postgres real |
| Build de Vercel | `vercel build` oficial (CLI 39.1.1) en local: genera la parte estática, 2 funciones en Node 22 y el cron diario |

## Lo que **no** se ha podido probar (faltan vuestras cuentas)

| Prueba | Por qué | Cómo hacerla |
|---|---|---|
| Guardado en **vuestro** Supabase | No hay proyecto creado ni claves | DEPLOY.md, paso 3 |
| Políticas de seguridad en **vuestro** Supabase | Ídem. Se ha probado el mismo SQL en Postgres con los mismos roles | DEPLOY.md, paso 3; intentar leer con la clave `anon` debe fallar |
| Web publicada en Vercel, HTTPS y dominio | No hay cuenta ni despliegue. **La web no está publicada todavía** | DEPLOY.md, pasos 2 y 4 |
| Cabeceras de seguridad y cron en Vercel | Solo se aplican en Vercel. `vercel build` confirma que la configuración es válida | Tras desplegar: Settings → Cron Jobs |
| Tiempo de espera de 15 s del formulario | Se ha probado el mismo camino con una respuesta perdida (mismo mensaje y misma lógica de reintento), no esperando 15 s reales | — |

## Resultados

### Web
| | Prueba | Resultado |
|---|---|---|
| ✔ | El proyecto compila (`npm run build` y `vercel build`) | Superada |
| ✔ | Todos los textos con traducción cambian al elegir idioma (CA, ES, EN) | Superada |
| ✔ | Sin desbordamiento horizontal ni imágenes rotas en 390, 768 y 1280 px, en los 3 idiomas | Superada |
| ✔ | El idioma elegido se recuerda al recargar y aparece en el enlace (`?lang=`) | Superada |
| ✔ | El texto visible es idéntico al de la versión anterior en los 3 idiomas: no se ha perdido contenido | Superada (comparación automática) |

### RSVP (las 10 comprobaciones del encargo)
| # | Prueba | Resultado |
|---|---|---|
| 1 | RSVP válido en los 3 idiomas → fila en la base de datos con idioma, pareja, dietas y bus | ✔ Superada |
| 2 | "No vengo" → se guarda sin datos de preboda ni transporte | ✔ Superada |
| 3 | Regla de pareja: máximo titular + pareja (restricción en la base de datos); el nombre de la pareja es obligatorio y distinto del titular | ✔ Superada |
| 4 | Campos vacíos o no válidos → error traducido, sin guardar; el servidor rechaza 17 tipos de datos incorrectos | ✔ Superada |
| 5 | Formulario completo en catalán, castellano e inglés | ✔ Superada |
| 6 | Doble clic → 1 petición, 1 fila. Reenvío con la misma clave → no duplica. Mismo nombre otra vez → aviso traducido | ✔ Superada |
| 7 | Sin conexión, error de base de datos o respuesta perdida → nunca sale "recibido", no se pierde lo escrito y el reintento guarda una sola vez | ✔ Superada |
| 8 | Al recargar, el registro sigue en la base de datos, y sigue tras cerrar y reabrir la base de datos | ✔ Superada |
| 9 | El público (`anon`/`authenticated`) no puede leer, insertar, modificar, borrar ni llamar a la función. RLS bloquea incluso si alguien concediera permisos por error. La web no contiene claves | ✔ Superada |
| 10 | Vosotros podéis ver totales y exportar un CSV con todos los invitados | ✔ Superada |

### Extra
| Prueba | Resultado |
|---|---|
| Límite de abuso: la respuesta 21 desde una misma conexión en 10 min se frena con aviso traducido | ✔ Superada |
| Los errores del servidor no escriben datos de invitados en los registros | ✔ Superada |
| `/api/keepalive` solo responde a Vercel con su secreto y no devuelve datos | ✔ Superada |
| La migración se puede ejecutar dos veces sin perder datos | ✔ Superada |

Todas las pruebas usan nombres inventados y una base de datos temporal. No se ha tocado ningún dato real.
