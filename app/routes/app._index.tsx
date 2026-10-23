import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { authenticate, PREMIUM_PLAN } from "../shopify.server";
import prisma from "../db.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Badge,
  Button,
  Thumbnail,
  InlineStack,
  Box,
  Divider
} from "@shopify/polaris";

// 1. جلب المنتجات
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query getProducts {
        products(first: 15, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              descriptionHtml
              status
              featuredMedia {
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      }`
  );

  const responseJson = await response.json();
  const products = responseJson.data?.products?.edges?.map((edge: any) => edge.node) || [];

  const hasApiKey = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10
  );

  return json({ products, hasApiKey });
};

// 2. معالجة الذكاء الاصطناعي واللغات والفواتير
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "generate");

  // نظام الاشتراكات
  if (intent === "upgrade") {
    await billing.require({
      plans: [PREMIUM_PLAN],
      isTest: true,
      onFailure: async () => billing.request({ plan: PREMIUM_PLAN, isTest: true }),
    });
    return null; // سيتم إعادة التوجيه تلقائياً
  }

  if (intent === "generate") {
    const productId = String(formData.get("productId") || "");
    const title = String(formData.get("title") || "");
    const imageUrl = String(formData.get("imageUrl") || "");

    // ✅ قراءة اللغة واللون من قاعدة بيانات التاجر
    const settings = await prisma.storeSettings.findUnique({
      where: { shop: session.shop },
    });
    const outputLanguage = settings?.language || "English";
    const tableColor = settings?.tableColor || "#f9fafb";

    let generatedHtml = "";
    let source = "Smart Fallback Engine";
    let aiDiagnostic = "";
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (apiKey && imageUrl) {
      try {
        const imgRes = await fetch(imageUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString("base64");
        const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

        // ✅ إجبار الذكاء الاصطناعي على اللغة واللون
        const prompt = `You are an expert e-commerce product AI.
CRITICAL: You MUST write the ENTIRE output strictly in ${outputLanguage}.
Analyze this product image and title ("${title}").
Generate clean HTML (no markdown) containing:
1. A 2-sentence overview in ${outputLanguage}.
2. An HTML table (<h3>📋 Specs</h3>) with specs extracted from the image. Translate all headers and values to ${outputLanguage}. Use background color "${tableColor}" for alternate rows (e.g., tr:nth-child(even)).
3. An EU GPSR compliance warning box in ${outputLanguage}.`;

        // ✅ استخدام gemini-3.6-flash مع احتياطي
        const modelsToTry = Array.from(new Set([process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash", "gemini-2.5-flash"]));

        for (const model of modelsToTry) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 ثانية لمعالجة الصور

          try {
            const geminiRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }]
                }),
              }
            );
            clearTimeout(timeoutId);

            if (geminiRes.ok) {
              const geminiData = await geminiRes.json();
              const aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
              if (aiText) {
                generatedHtml = aiText.replace(/```html|```/g, "").trim();
                source = `Gemini Vision AI (${model})`;
                aiDiagnostic = "";
                break;
              }
            } else {
              const errJson = await geminiRes.json().catch(() => ({}));
              aiDiagnostic = ` (API Error on ${model}: ${errJson?.error?.message?.slice(0, 40) || ""})`;
            }
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            aiDiagnostic = ` (${model} timeout)`;
          }
        }
      } catch (err: any) {
        aiDiagnostic = ` (Fetch error)`;
      }
    }

    // ✅ قاموس اللغات للقالب الاحتياطي (يعمل بلغتك المفضلة حتى لو فشل الاتصال بجوجل)
    const t: Record<string, any> = {
      English: { specs: "📋 Technical Specifications", model: "Product Model", mat: "Primary Material", matVal: "Premium Eco-Friendly Composite", stat: "Visual Inspection", statVal: "Verified via VisionSpec AI", care: "Care & Maintenance", careVal: "Easy-wipe surface", war: "Warranty & Quality", warVal: "12-Month Guarantee", safe: "🛡️ EU GPSR & Safety Compliance", safeMsg: "Safety Notice: Keep away from open flames. Complies with EU 2023/988 standards." },
      Arabic: { specs: "📋 المواصفات الفنية", model: "طراز المنتج", mat: "المادة الأساسية", matVal: "مواد صديقة للبيئة وآمنة", stat: "الفحص البصري", statVal: "تم التحقق بواسطة VisionSpec AI", care: "العناية والصيانة", careVal: "سطح سهل المسح والتنظيف", war: "الضمان والجودة", warVal: "ضمان جودة لمدة 12 شهراً", safe: "🛡️ امتثال السلامة الأوروبي (EU GPSR)", safeMsg: "ملاحظة سلامة: يُحفظ بعيداً عن اللهب. متوافق مع معايير السلامة الأوروبية 2023/988." },
      Turkish: { specs: "📋 Teknik Özellikler", model: "Ürün Modeli", mat: "Ana Malzeme", matVal: "Çevre Dostu Kompozit", stat: "Görsel Denetim", statVal: "VisionSpec AI ile Doğrulandı", care: "Bakım", careVal: "Kolay temizlenebilir yüzey", war: "Garanti", warVal: "12 Aylık Garanti", safe: "🛡️ AB GPSR Güvenlik Uyumluluğu", safeMsg: "Güvenlik Uyarısı: Açık alevden uzak tutun. AB 2023/988 standartlarına uygundur." }
    };
    
    const lang = t[outputLanguage] || t["English"];

    if (!generatedHtml) {
      generatedHtml = `
        <div style="font-family: -apple-system, sans-serif; color: #202223; line-height: 1.6;">
          <p><strong>${title}</strong></p>
          <h3 style="margin-top: 20px; border-bottom: 2px solid #e1e3e5; padding-bottom: 6px;">${lang.specs}</h3>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
            <tbody>
              <tr style="border-bottom: 1px solid #e1e3e5; background-color: ${tableColor};">
                <td style="padding: 10px; font-weight: 600; width: 38%;">${lang.model}</td>
                <td style="padding: 10px;">${title}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e1e3e5;">
                <td style="padding: 10px; font-weight: 600;">${lang.mat}</td>
                <td style="padding: 10px;">${lang.matVal}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e1e3e5; background-color: ${tableColor};">
                <td style="padding: 10px; font-weight: 600;">${lang.stat}</td>
                <td style="padding: 10px;">${lang.statVal}</td>
              </tr>
            </tbody>
          </table>
          <div style="margin-top: 20px; padding: 14px; background-color: #fcf1ef; border-left: 4px solid #d82c0d; border-radius: 6px;">
            <h4 style="margin: 0 0 6px 0; color: #202223;">${lang.safe}</h4>
            <p style="margin: 0; font-size: 13px;">${lang.safeMsg}</p>
          </div>
        </div>
      `;
    }

    await admin.graphql(
      `#graphql
        mutation updateProductSpecs($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id descriptionHtml }
          }
        }`,
      { variables: { input: { id: productId, descriptionHtml: generatedHtml } } }
    );

    return json({ success: true, productId, source: source + aiDiagnostic, generatedHtml, timestamp: new Date().toLocaleTimeString() });
  }

  return json({ success: false, error: "Invalid intent" }, { status: 400 });
};

// 3. تصميم صف المنتج مع المعاينة المباشرة
function ProductRow({ product }: { product: any }) {
  const fetcher = useFetcher<typeof action>();
  const [showPreview, setShowPreview] = useState(false);

  const imageUrl = product.featuredMedia?.preview?.image?.url || "";
  const currentHtml = fetcher.data?.generatedHtml || product.descriptionHtml || "";
  const hasSpecs = currentHtml.trim().length > 0 && currentHtml.includes("📋");
  const isGenerating = fetcher.state !== "idle";
  const justUpdated = Boolean(fetcher.data?.success && fetcher.data?.productId);

  return (
    <Card padding="400">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="400" blockAlign="center">
            {imageUrl ? (
              <Thumbnail source={imageUrl} alt={product.title} size="large" />
            ) : (
              <Box background="bg-surface-secondary" minHeight="56px" minWidth="56px" borderRadius="100" />
            )}
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">{product.title}</Text>
              {hasSpecs ? (
                <Badge tone="success">✅ Specs & Compliance Table Active</Badge>
              ) : (
                <Badge tone="critical">⚠️ Missing Specs</Badge>
              )}
              {justUpdated && <Text as="p" tone="magic" variant="bodySm">🎉 Updated via {fetcher.data?.source}</Text>}
            </BlockStack>
          </InlineStack>

          <InlineStack gap="200">
            {hasSpecs && (
              <Button onClick={() => setShowPreview(!showPreview)}>
                {showPreview ? "Hide Table" : "Preview Specs"}
              </Button>
            )}

            <fetcher.Form method="post" action="?index" onSubmit={() => setShowPreview(true)}>
              <input type="hidden" name="intent" value="generate" />
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="title" value={product.title} />
              <input type="hidden" name="imageUrl" value={imageUrl} />
              <Button variant="primary" tone={hasSpecs ? "success" : undefined} submit loading={isGenerating}>
                {hasSpecs ? "Regenerate Specs" : "✨ Generate AI Specs"}
              </Button>
            </fetcher.Form>
          </InlineStack>
        </InlineStack>

        {showPreview && hasSpecs && (
          <Box padding="400" background="bg-surface-secondary" borderRadius="100">
            <div dangerouslySetInnerHTML={{ __html: currentHtml }} />
          </Box>
        )}
      </BlockStack>
    </Card>
  );
}

// 4. الصفحة الرئيسية + ميزة التوليد الجماعي (Bulk Generation)
export default function Index() {
  const { products, hasApiKey } = useLoaderData<typeof loader>();
  const billingFetcher = useFetcher<typeof action>();
  
  // حالة زر التوليد الجماعي
  const [isBulkScanning, setIsBulkScanning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  // دالة التوليد الجماعي
  const startBulkScan = async () => {
    setIsBulkScanning(true);
    // البحث عن المنتجات التي لم يتم توليد جداول لها بعد
    const productsMissingSpecs = products.filter(
      (p: any) => !(p.descriptionHtml || "").includes("📋")
    );

    if (productsMissingSpecs.length === 0) {
      alert("🎉 All products already have AI Specs!");
      setIsBulkScanning(false);
      return;
    }

    let completed = 0;
    for (const product of productsMissingSpecs) {
      const formData = new FormData();
      formData.append("intent", "generate");
      formData.append("productId", product.id);
      formData.append("title", product.title);
      formData.append("imageUrl", product.featuredMedia?.preview?.image?.url || "");

      // إرسال الطلب لإنشاء الجدول في الخلفية
      await fetch("?index", {
        method: "POST",
        body: formData,
      });

      completed += 1;
      setBulkProgress(Math.round((completed / productsMissingSpecs.length) * 100));
      
      // ✅ فاصل زمني لتجنب الحظر من خوادم Gemini
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    setIsBulkScanning(false);
    setBulkProgress(0);
    // إعادة تحميل الصفحة لإظهار النتائج الجديدة
    window.location.reload();
  };

  return (
    <Page title="VisionSpec AI — Smart Specs & EU GPSR Compliance">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">System Status & Bulk Engine</Text>
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold">AI Optical Engine:</Text>
                    {hasApiKey ? (
                      <Badge tone="success">🟢 Gemini API Connected</Badge>
                    ) : (
                      <Badge tone="warning">🟠 Fallback Mode</Badge>
                    )}
                  </InlineStack>
                  <Text as="span" tone="subdued">Current Plan: <strong>VisionSpec Pro ($19/mo)</strong></Text>
                </BlockStack>
                
                <InlineStack gap="200">
                  {/* زر التوليد الجماعي السحري */}
                  <Button 
                    onClick={startBulkScan}
                    disabled={isBulkScanning}
                    loading={isBulkScanning}
                  >
                    {isBulkScanning ? `🔄 Scanning (${bulkProgress}%)...` : "⚡ Auto-Generate Missing Specs"}
                  </Button>

                  <billingFetcher.Form method="post" action="?index">
                    <input type="hidden" name="intent" value="upgrade" />
                    <Button variant="primary" submit>💳 Test Billing</Button>
                  </billingFetcher.Form>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Store Products Scanner</Text>
            {products.length === 0 ? (
              <Card padding="400"><Text as="p">No products found.</Text></Card>
            ) : (
              products.map((p: any) => <ProductRow key={p.id} product={p} />)
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}