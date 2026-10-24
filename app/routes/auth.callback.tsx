import type { LoaderFunctionArgs } from "@remix-run/node";
import { shopify } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await shopify.authenticate.admin(request);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  
  // توجيه صحيح للمسار الجديد
  if (shop) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://admin.shopify.com/store/${shop.split('.')[0]}/apps/visionspec-pro-ai`,
      },
    });
  }
  return new Response("Missing shop parameter", { status: 400 });
};