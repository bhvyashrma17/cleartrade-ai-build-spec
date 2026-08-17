import {validateRuntimeEnvironment} from '@/lib/runtime-config';
export async function register(){if(process.env.NEXT_RUNTIME==='nodejs')validateRuntimeEnvironment('web');}
