# 会社別の設計図クリック計測（2026-10-24の依頼）

これから送る文面の設計図URLを会社別のランダムな識別子に置き換える。開いた記録を保存し、既存の業種別設計図へ302で転送する。営業文の文章・予約リンク・フォームの入力値・送信判定・D1のステータス更新処理は変更しない。

送付済みの共通URLのクリックは会社に関連付けられない。この変更より前にチェックアウトされたActions実行には適用されない。追跡の確認のために会社へ再送しない。

## 構成

- 接続先：Supabaseプロジェクト `lxxzvbggxoroxayiupfj` のEdge Function `ls-flow`。
- `会社別URL.mjs`：送信直前に、既存の5種類の設計図URLだけを会社別に変換する。
- `会社別リンク.json`：会社IDと公開用リンクの識別子・業種の対応表。データベースの管理キーは含めない。
- `index.ts`・`redirect-handler.mjs`：識別子を検証し、記録・転送を行う。未登録識別子と任意サイトへの転送は受け付けない。
- `schema.sql`：新規の計測専用テーブルと非公開集計ビュー。D1や既存のLINEメッセージのテーブルには書き込まない。

会社別リンクが未登録、または業種と文面URLが違うときは、フォームを開く前にエラーで停止する。共通リンクへ戻して送付を続けない。新しい会社を送るときは、先に追跡用の対応表を更新する。

## 新しい会社を対応表に追加する

1. 最新のD1を読み、対象の会社ID・会社名・業種・v8の文面IDを確認する。D1への手動更新はしない。
2. Supabaseの `public.line_stock_tracking_links` に計測用の行を追加する。`token` は既定値でランダムに発行する。同じ会社の既存の識別子は再発行しない。`page` は実際の文面URLの業種に合わせる。
3. `select company_id, token, page from public.line_stock_tracking_links where not is_test order by company_id;` の結果を `会社別リンク.json` の `links` に反映する。
4. 本番送付前にdryと記録で会社別URLが入ることを確認する。送付済み・失敗の会社を確認用に再送しない。

これは計測先への登録手順であり、営業候補をD1に登録する手順ではない。

## クリックした会社を確認する

Supabaseの認証済み接続で以下を実行する。一般公開のAPIキーでは、会社一覧・クリック記録・このビューは読めない。

```sql
select company_id, company_name, industry, views, daily_visitors,
       first_clicked_at at time zone 'Asia/Tokyo' as first_clicked_jst,
       last_clicked_at at time zone 'Asia/Tokyo' as last_clicked_jst
from public.line_stock_company_clicks
where views > 0
order by last_clicked_at desc;
```

クリックがあっても、送った会社の担当者本人とは限らない。転送先・代理閲覧者も元の会社の識別子で記録される。明らかなボット・リンクプレビュー・先読み・HEADは人数に含めないが、自動確認を完全には除外できない。

IPとUser-Agentそのものは保存せず、会社・日本時間の日付・接続情報から作ったHMACを重複確認に使う。同じ識別情報の同日の閲覧は1つとして集計し、別日は別カウントになる。`views` は延べ閲覧数、`daily_visitors` はこの日単位の重複を除いた数。

計測の保存に一時障害があっても、識別子を確認できていれば設計図への転送を続ける。その場合のクリック記録は欠測する。識別子を確認するデータベース自体に接続できない場合は503になる。

## 検証

```bash
node --test 追跡/追跡.test.mjs
node --check 送信.mjs
```

公開先では `is_test=true` の専用行でGET2回→閲覧2・日次閲覧者1、HEAD/ボット→加算なし、未登録識別子→404、既存設計図への転送を確認した。テスト行は本番の集計から除外され、確認後に削除する。
