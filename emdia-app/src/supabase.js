import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "https://pilcntubpyzhigwlhule.supabase.co";
const key = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_VLYr_vT7-jq_QpcOXanzAQ_GiNzDvyR";

export const supabase = createClient(url, key);
