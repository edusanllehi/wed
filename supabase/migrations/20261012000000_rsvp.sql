-- =====================================================================
-- RSVP · Berta i Edu · 15.05.2027
-- Ejecutad este archivo entero en Supabase → SQL Editor → New query → Run.
-- Es idempotente en lo posible: se puede volver a ejecutar sin perder datos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas
--    rsvp_responses : una fila por respuesta (persona o pareja)
--    rsvp_guests    : una fila por invitado (titular y, si viene, su pareja)
-- ---------------------------------------------------------------------
create table if not exists public.rsvp_responses (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null unique,              -- clave de idempotencia del navegador
  attending      boolean not null,
  with_partner   boolean not null default false,
  prewedding     boolean,                           -- null si no viene a la boda
  transport      text check (transport in ('bus', 'car')),
  message        text check (char_length(message) <= 2000),
  language       text not null check (language in ('ca', 'es', 'en')),
  ip_hash        text,                              -- hash salado, solo para limitar abusos
  created_at     timestamptz not null default now(),
  constraint partner_only_if_attending    check (attending or not with_partner),
  constraint prewedding_only_if_attending check (attending or prewedding is null),
  constraint transport_only_if_attending  check (attending or transport is null),
  constraint message_only_if_attending    check (attending or message is null)
);

create table if not exists public.rsvp_guests (
  id             uuid primary key default gen_random_uuid(),
  response_id    uuid not null references public.rsvp_responses(id) on delete cascade,
  role           text not null check (role in ('primary', 'partner')),
  full_name      text not null check (char_length(btrim(full_name)) between 2 and 120),
  name_key       text generated always as (lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))) stored,
  dietary        text[] not null default '{}'
                 check (dietary <@ array['none','vegetarian','vegan','gluten_free','lactose_free','nuts','shellfish','fish','pregnant']::text[]),
  dietary_other  text check (char_length(dietary_other) <= 300),
  created_at     timestamptz not null default now(),
  unique (response_id, role)                       -- como máximo titular + pareja
);

-- Un mismo nombre no puede responder dos veces (ni como titular ni como pareja)
create unique index if not exists rsvp_guests_name_key_uniq on public.rsvp_guests (name_key);
create index if not exists rsvp_guests_response_idx       on public.rsvp_guests (response_id);
create index if not exists rsvp_responses_created_idx     on public.rsvp_responses (created_at);
create index if not exists rsvp_responses_ip_recent_idx   on public.rsvp_responses (ip_hash, created_at);

-- ---------------------------------------------------------------------
-- 2. Seguridad: nadie desde la web pública puede leer ni escribir.
--    RLS activado sin políticas = acceso denegado a anon/authenticated.
--    Solo el servidor (service_role) y el panel de Supabase acceden.
-- ---------------------------------------------------------------------
alter table public.rsvp_responses enable row level security;
alter table public.rsvp_guests    enable row level security;
revoke all on public.rsvp_responses from anon, authenticated;
revoke all on public.rsvp_guests    from anon, authenticated;
-- El servidor (service_role) necesita acceso explícito si el proyecto no expone tablas automáticamente
grant select, insert, update, delete on public.rsvp_responses, public.rsvp_guests to service_role;

-- ---------------------------------------------------------------------
-- 3. Guardado atómico e idempotente (lo llama /api/rsvp con service_role)
--    Devuelve {status: ok | duplicate | rate_limited | invalid}
-- ---------------------------------------------------------------------
create or replace function public.submit_rsvp(p jsonb, p_ip_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub      uuid;
  v_id       uuid;
  v_attend   boolean;
  v_partner  boolean;
  v_recent   int;
begin
  begin
    v_sub     := (p->>'submission_id')::uuid;
    v_attend  := (p->>'attending')::boolean;
    v_partner := coalesce((p->>'with_partner')::boolean, false);
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;
  if v_sub is null or v_attend is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Reintento del mismo envío: devolvemos el resultado anterior sin duplicar
  select id into v_id from rsvp_responses where submission_id = v_sub;
  if found then
    return jsonb_build_object('status', 'ok', 'replayed', true);
  end if;

  -- Límite de abuso: máx. 20 respuestas por conexión cada 10 minutos
  -- (holgado para que varios invitados que compartan wifi o red móvil no se bloqueen)
  if p_ip_hash is not null then
    select count(*) into v_recent
      from rsvp_responses
     where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes';
    if v_recent >= 20 then
      return jsonb_build_object('status', 'rate_limited');
    end if;
  end if;

  begin
    insert into rsvp_responses (submission_id, attending, with_partner, prewedding, transport, message, language, ip_hash)
    values (
      v_sub,
      v_attend,
      v_attend and v_partner,
      case when v_attend then (p->>'prewedding')::boolean end,
      case when v_attend then nullif(p->>'transport', '') end,
      case when v_attend then nullif(p->>'message', '') end,
      p->>'language',
      p_ip_hash
    )
    returning id into v_id;

    insert into rsvp_guests (response_id, role, full_name, dietary, dietary_other)
    values (
      v_id, 'primary', btrim(p->>'name'),
      case when v_attend then coalesce(array(select jsonb_array_elements_text(p->'dietary')), '{}') else '{}' end,
      case when v_attend then nullif(p->>'dietary_other', '') end
    );

    if v_attend and v_partner then
      insert into rsvp_guests (response_id, role, full_name, dietary, dietary_other)
      values (
        v_id, 'partner', btrim(p->>'partner_name'),
        coalesce(array(select jsonb_array_elements_text(p->'partner_dietary')), '{}'),
        nullif(p->>'partner_dietary_other', '')
      );
    end if;
  exception
    when unique_violation then
      -- Carrera con el mismo envío (doble clic simultáneo) → idempotente
      if exists (select 1 from rsvp_responses where submission_id = v_sub) then
        return jsonb_build_object('status', 'ok', 'replayed', true);
      end if;
      return jsonb_build_object('status', 'duplicate');
    when check_violation or not_null_violation or invalid_text_representation or invalid_parameter_value then
      return jsonb_build_object('status', 'invalid');
  end;

  return jsonb_build_object('status', 'ok', 'replayed', false);
end;
$$;

revoke all on function public.submit_rsvp(jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_rsvp(jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- 4. Vistas para vosotros (exportar a CSV y ver totales)
-- ---------------------------------------------------------------------
create or replace function public.rsvp_diet_label(code text)
returns text language sql immutable as $$
  select case code
    when 'none' then 'Ninguna' when 'vegetarian' then 'Vegetariana' when 'vegan' then 'Vegana'
    when 'gluten_free' then 'Celiaquía / sin gluten' when 'lactose_free' then 'Sin lactosa'
    when 'nuts' then 'Frutos secos' when 'shellfish' then 'Marisco' when 'fish' then 'Pescado'
    when 'pregnant' then 'Embarazada' else code end
$$;

create or replace view public.rsvp_export
with (security_invoker = true) as
select
  to_char(r.created_at at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') as fecha,
  g.full_name                                                           as invitado,
  case g.role when 'primary' then 'Titular' else 'Pareja' end           as rol,
  case when r.attending then 'Sí' else 'No' end                         as asiste,
  case when not r.attending then '' when r.prewedding then 'Sí' else 'No' end as preboda,
  case r.transport when 'bus' then 'Bus' when 'car' then 'Coche' else '' end as transporte,
  array_to_string(array(select public.rsvp_diet_label(x) from unnest(g.dietary) x), ', ') as dieta,
  coalesce(g.dietary_other, '')                                         as dieta_detalle,
  coalesce(r.message, '')                                               as mensaje,
  upper(r.language)                                                     as idioma,
  r.id                                                                  as respuesta_id
from public.rsvp_responses r
join public.rsvp_guests g on g.response_id = r.id
order by r.created_at, r.id, g.role desc;

create or replace view public.rsvp_totals
with (security_invoker = true) as
select
  count(*) filter (where r.attending)                                   as personas_que_vienen,
  count(distinct r.id) filter (where not r.attending)                   as respuestas_que_no_vienen,
  count(*) filter (where r.attending and r.prewedding)                  as personas_preboda,
  count(*) filter (where r.attending and r.transport = 'bus')           as personas_bus,
  count(*) filter (where r.attending and g.dietary && array['vegetarian','vegan','gluten_free','lactose_free','nuts','shellfish','fish','pregnant']) as personas_con_restricciones
from public.rsvp_responses r
join public.rsvp_guests g on g.response_id = r.id;

revoke all on public.rsvp_export from anon, authenticated;
revoke all on public.rsvp_totals from anon, authenticated;
revoke all on function public.rsvp_diet_label(text) from public, anon, authenticated;
grant execute on function public.rsvp_diet_label(text) to service_role;
grant select on public.rsvp_export, public.rsvp_totals to service_role;
