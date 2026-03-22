create or replace function public.update_food_entry_with_values(
  p_entry_id uuid,
  p_item_name text,
  p_consumed_at timestamptz,
  p_meal_type public.meal_time,
  p_serving_qty numeric,
  p_serving_unit text,
  p_manual_notes text,
  p_nutrients jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entry public.food_entries%rowtype;
  v_item jsonb;
  v_nutrient_code text;
  v_nutrient_unit text;
  v_amount numeric;
begin
  select * into v_entry from public.food_entries where id = p_entry_id for update;
  if not found then
    raise exception 'entry % not found', p_entry_id using errcode = 'P0002';
  end if;

  if not public.can_modify_entry(auth.uid(), v_entry.id) then
    raise exception 'not authorized to edit this food entry' using errcode = '42501';
  end if;

  if coalesce(trim(p_item_name), '') = '' then
    raise exception 'item_name is required' using errcode = '22023';
  end if;

  if p_serving_qty is null or p_serving_qty <= 0 then
    raise exception 'serving_qty must be positive' using errcode = '22023';
  end if;

  if coalesce(trim(p_serving_unit), '') = '' then
    raise exception 'serving_unit is required' using errcode = '22023';
  end if;

  update public.food_entries
  set item_name = trim(p_item_name),
      consumed_at = p_consumed_at,
      meal_type = p_meal_type,
      serving_qty = p_serving_qty,
      serving_unit = trim(p_serving_unit),
      manual_notes = nullif(trim(p_manual_notes), ''),
      source_label = coalesce(source_label, 'manual'),
      updated_at = timezone('UTC', now())
  where id = v_entry.id;

  delete from public.food_entry_nutrients
  where entry_id = v_entry.id
    and source = 'edited';

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_nutrients, '[]'::jsonb))
  loop
    v_nutrient_code := trim(lower(v_item ->> 'nutrient_code'));
    if v_nutrient_code = '' then
      continue;
    end if;

    if not exists (
      select 1
      from public.nutrient_definitions nd
      where nd.code = v_nutrient_code
    ) then
      continue;
    end if;

    begin
      if (v_item ->> 'amount') ~ '^-?\\d+(?:\\.\\d+)?$' then
        v_amount := (v_item ->> 'amount')::numeric;
      else
        v_amount := null;
      end if;
    exception
      when invalid_text_representation then
        v_amount := null;
    end;

    if v_amount is null or v_amount < 0 then
      continue;
    end if;

    v_nutrient_unit := trim(v_item ->> 'unit');
    if v_nutrient_unit = '' then
      select nd.unit into v_nutrient_unit
      from public.nutrient_definitions nd
      where nd.code = v_nutrient_code
      limit 1;
    end if;

    if v_nutrient_unit is null or trim(v_nutrient_unit) = '' then
      continue;
    end if;

    insert into public.food_entry_nutrients (
      entry_id,
      nutrient_code,
      amount,
      unit,
      source,
      source_confidence,
      source_model,
      created_by,
      updated_at,
      created_at
    )
    values (
      v_entry.id,
      v_nutrient_code,
      v_amount,
      v_nutrient_unit,
      'edited',
      1,
      'manual',
      auth.uid(),
      timezone('UTC', now()),
      timezone('UTC', now())
    )
    on conflict (entry_id, nutrient_code)
    do update set
      amount = excluded.amount,
      unit = excluded.unit,
      source = excluded.source,
      source_confidence = excluded.source_confidence,
      source_model = excluded.source_model,
      created_by = excluded.created_by,
      updated_at = excluded.updated_at;
  end loop;

  return v_entry.id;
end;
$$;
