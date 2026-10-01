import { adminClient } from '../_shared/client.ts';
import { createHandler } from './handler.ts';

Deno.serve(createHandler(adminClient));
