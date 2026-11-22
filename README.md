# Clay XR (WebXR 試作)

立方体の粘土を手で押す・盛る・なでる・つまんで引っ張るための試作です。
Android XR の Chrome (WebXR + ハンドトラッキング) で動かすことを想定しています。

## ファイル

| ファイル | 中身 |
|---|---|
| `index.html` | 画面 UI と three.js の読み込み (CDN, r170) |
| `src/sdf.js` | 粘土の距離場 (80³ ボクセル)、押す・盛る・なでる・引っ張る、Surface Nets によるメッシュ化 |
| `src/main.js` | シーン、マウス操作、XR のハンド入力、移動・回転・拡大、Undo、GLB 書き出し |
| `src/panel.js` | XR 空間に浮かぶボタン |

## Mac で動かす

```bash
python3 -m http.server 8080
```

ブラウザで http://localhost:8080 を開きます。粘土の上でドラッグすると造形、何もない所をドラッグすると視点が回ります。

## Android XR 実機 (Galaxy XR など) で動かす

WebXR は HTTPS か localhost でしか動きません。USB でつないで、ポートを転送するのがいちばん手軽です。

1. ヘッドセットで開発者向けオプションと USB デバッグを有効にし、Mac と USB でつなぐ
2. Mac でサーバーを起動する (上と同じ)
3. ポートを転送する

   ```bash
   adb reverse tcp:8080 tcp:8080
   ```

4. ヘッドセットの Chrome で http://localhost:8080 を開き、「VRで開始」か「パススルー」を押す

USB を使わない場合は、GitHub Pages などの HTTPS のサイトに置いて開きます。

## XR での操作

- 人差し指の先で触れる: パネルで選んだ道具 (押す / 盛る / なでる)
- 粘土の表面をつまむ: 引っ張る
- 何もない所をつまむ: 粘土を移動。両手でつまむと回転・拡大縮小
- 左手側のパネル: 道具、ブラシの大きさ、戻す、手元へ (正面に呼び戻す)、リセット

## 調整しやすい値 (`src/main.js` の先頭)

- `PINCH_ON` / `PINCH_OFF`: ピンチと判定する親指と人差し指の距離 (2cm / 4cm)
- `PRE_PINCH`: これより指が閉じていると指先の道具を止める (5cm)
- `grabR`: 引っ張るときにつかむ範囲 (ブラシ半径 × 2.2)
- `OneEuro3(minCutoff, beta)`: 手の震えを抑えるフィルタ
- `ClayField({ N: 80, size: 0.4 })`: 格子の細かさと造形できる範囲 (40cm 角)
