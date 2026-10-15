do $$
begin
 if not public.valid_memory_location(null) then raise exception 'legacy null rejected'; end if;
 if not public.valid_memory_location('{"source":"pin","lat":33.59,"lng":130.4}') then raise exception 'pin rejected'; end if;
 if not public.valid_memory_location('{"source":"place","placeId":"synthetic-place"}') then raise exception 'place rejected'; end if;
 if public.valid_memory_location('{"source":"pin","lat":91,"lng":130}') then raise exception 'invalid latitude accepted'; end if;
 if public.valid_memory_location('{"source":"pin","lat":"33","lng":130}') then raise exception 'string coordinate accepted'; end if;
 if public.valid_memory_location('{"source":"place","placeId":""}') then raise exception 'empty place accepted'; end if;
 if public.valid_memory_location('{"source":"place","placeId":"synthetic","displayName":"must not persist"}') then raise exception 'Google content accepted'; end if;
 if has_function_privilege('anon','public.claim_recording_with_location(uuid,text,text,integer,bigint,text,jsonb)','execute') then raise exception 'anonymous claim RPC exposed'; end if;
end $$;
