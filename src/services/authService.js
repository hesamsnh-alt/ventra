import { supabase } from "@/lib/supabase";

export async function signInUser(email, password) {
  const cleanEmail = email.trim().toLowerCase();

  const { data, error } =
    await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

  return {
    user: data?.user || null,
    session: data?.session || null,
    error,
  };
}

export async function signUpUser({
  fullName,
  email,
  password,
}) {
  const cleanEmail = email.trim().toLowerCase();

  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,

    options: {
      data: {
        full_name: fullName.trim(),
      },
    },
  });

  return {
    user: data?.user || null,
    session: data?.session || null,
    error,
  };
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();

  return { error };
}

export async function getCurrentUser() {
  const { data, error } =
    await supabase.auth.getUser();

  return {
    user: data?.user || null,
    error,
  };
}

export async function getCurrentSession() {
  const { data, error } =
    await supabase.auth.getSession();

  return {
    session: data?.session || null,
    error,
  };
}