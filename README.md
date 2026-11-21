# taiwan-rail-transfer V12

GitHub Pages 靜態查詢工具。預設開啟原有竹南 ↔ 二水三段查詢，點選「全站查詢」即可從當日有班次的台鐵與高鐵車站選擇起訖站。全站選單依官方地址分縣市，縣市以最南車站緯度排序，縣市內依各站緯度由南到北，並在站名前標示台鐵或高鐵。兩種模式共用搭乘日期與最早出發時間。匯入與查詢範圍是台灣時間今天至第 7 天，共 8 天。

全站查詢依列車實際停靠順序與 TDX 指定日期預定班次連接路線，分別顯示綜合、直達、轉乘的 TOP 3。最快抵達依最終抵達時間排序。同站換車預留 5 分鐘，跨站步行連接依車站預留 10–15 分鐘。走完後的候車時間上限為 90 分鐘。有步行連通的起訖站可安排搭車前或下車後步行。出發班次須在所選日期，跨日銜接只讀取次日班次檔。跨運具步行連接參考[台灣高鐵轉乘服務](https://www.thsrc.com.tw/ArticleContent/99e64de4-a5eb-4081-ad3c-c3596b4f307f)。

最低票價排名只比較每段成人票價均有資料的方案。高鐵採標準車廂對號座，台鐵採 TDX 起訖站成人票價，自強 3000、普悠瑪及太魯閣採一般自強車廂票種。TDX 標示為專開的列車依臺鐵專列規定購票，從一般方案排除。票價缺漏會保留該班次在時間排名，並顯示「票價待確認」。套用方案後可複製包含各段班次、步行與候車時間的行程。

## 資料發布

現有 update-trains GitHub Actions 使用原有 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET。V12 沿用 data/dates.json 及原有日期檔，同時產出 data/network/ 內的全站日期檔與 data/network-fares.json。合併後執行一次「Update Taiwan rail timetables」，待資料提交後即可使用全站查詢。票價更新失敗會保留已有票價檔，原有查詢仍可使用。

## 本機測試

- 執行 node --test tests/network.test.mjs 測試路線、轉乘門檻、排序與跨日。
- 執行 python -m unittest discover -s tests 測試資料轉換。
- 執行 python -m http.server 8000 後，以瀏覽器開啟 http://localhost:8000。全站查詢需要所選日期的全站資料檔。
