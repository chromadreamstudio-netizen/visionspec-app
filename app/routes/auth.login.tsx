import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { shopify } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  
  if (shop) {
    const errors = await shopify.login(request);
    return json({ errors });
  }
  return json({ errors: null });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = await shopify.login(request);
  return json({ errors });
};

export default function Login() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const errors = actionData?.errors || loaderData?.errors;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '50px' }}>
      <h1>Login to VisionSpec Pro AI</h1>
      {errors && <p style={{ color: 'red' }}>{errors.shop}</p>}
      <Form method="post">
        <input 
          type="text" 
          name="shop" 
          placeholder="your-shop.myshopify.com" 
          value={shop} 
          onChange={(e) => setShop(e.target.value)} 
          style={{ padding: '10px', fontSize: '16px', marginRight: '10px' }}
        />
        <button type="submit" style={{ padding: '10px 20px', fontSize: '16px' }}>Log In</button>
      </Form>
    </div>
  );
}