/**
 * ZenithOne Credit Union — Settings Module
 */

async function loadUserSettings() {
  if (!window._supabase) return;
  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) return;

  const { data: profile } = await window._supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (!profile) return;

  // Populate form fields
  const fields = {
    firstName: profile.full_name?.split(' ')[0] || '',
    lastName:  profile.full_name?.split(' ').slice(1).join(' ') || '',
    signupEmail: session.user.email || '',
    phone:     profile.phone || '',
    address:   profile.address || '',
    city:      profile.city || '',
  };

  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
}

async function updateProfile(data) {
  if (!window._supabase) return;
  const { data: { session } } = await window._supabase.auth.getSession();
  if (!session) return;

  const { error } = await window._supabase
    .from('profiles')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', session.user.id);

  return !error;
}

async function changePasswordRequest(newPassword) {
  if (!window._supabase) return;
  const { error } = await window._supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

document.addEventListener('DOMContentLoaded', loadUserSettings);
document.addEventListener('supabaseReady', loadUserSettings);
