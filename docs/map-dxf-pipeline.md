# 搬送エリア全体図：DXF → JSON 取込仕様 v0.1

関連：[全体マップ仕様書](specs/08-map.md)／[AGF通行・車線仕様書](specs/09-traffic.md)

この文書は**変換パイプラインとデータ契約**であり、現場図面の変換完了報告ではない。公開リポジトリに元図・元のファイル名・実座標・識別可能な設備形状を保存しない。実データのDXF、設定、生成JSONはローカルの private/ 以下等で管理し、レビュー・公開承認がない限りGitへ追加しない。

## 0. 運用状況

- DXF変換プログラム： [tools/dxf_to_map.py](../tools/dxf_to_map.py)
- 依存関係： [requirements-map.txt](../requirements-map.txt)
- 合成テスト： [tests/test_dxf_to_map.py](../tests/test_dxf_to_map.py)
- Gitに含む設定は**架空の合成サンプルのみ**。現場の全体マップJSONは未生成。
- 既に提供されたCADはDWG形式。現環境にDWG→DXF用の対応変換器がないため、このプロジェクトではまずCAD側でDXFに書き出す必要がある。ezdxfはDWGを直接読まない。PDFやスクリーンショットから寸法・経路を推定して変換完了としない。

## 1. DXFへ書き出し：単位・原点を統一

1. 使用するCADで対象階のモデル空間を確認する。外部参照があれば必要なものをバインドし、書き出しの欠落がないことを確認する。
2. **DXF**として保存する。DWGのファイル名や元図はGitへ入れない。
3. 図面単位を**mm**にし、DXFヘッダー $INSUNITS = 4 を確認する。
4. 全レイヤーで統一した原点（元の図面座標での x,y）を明記し、入力設定の originMm に登録する。実図面から勝手に原点を推定しない。
5. 回転・縮尺・各参照図の位置合わせをCAD側で確認する。X,Yの2D投影の扱いを記録し、現場との距離の一致を確認する。

**変換は単位がmmでないDXF・原点未指定を拒否**する。DXFに原寸法があっても、走行可能領域・AGF旋回可否・シャッターの制御が自動確定するわけではない。

## 2. レイヤー整理

ユーザーの「壁・扉・窓・什器・部屋名」を基に、AGF設備向けに以下へ整理する。

| レイヤー区分 | JSONの区分 | 取込み |
| --- | --- | --- |
| 壁 | walls | 線／ポリゴン |
| 扉 | doors | 線／ポリゴン |
| シャッター | shutters | 線／ポリゴン。通行許可はトポロジー側で別管理 |
| 窓 | windows | 表示用 |
| 什器 | fixtures | 表示／障害物用 |
| 設備 | equipment | 設備描画 |
| 個別パレットロケーション | palletLocations | 置場。AGFの走行通路とは区別 |
| エリア境界 | areaBoundaries | エリア識別 |
| 走行可能領域 | walkable | **明示した閉ポリゴンのみ**をグリッドに利用 |
| 走行中心線 | routeCenterlines | 描画用。これだけでは通行許可・車線数を確定しない |
| 部屋名／エリア名 | — | 注記は抽出しない。エリア名は別のトポロジー設定に明示 |

実際のDXFレイヤー名は [合成設定例](../examples/synthetic-map-config.json) を参考に、ローカル設定で完全一致にマッピングする。元のレイヤー名を公開リポジトリへ載せない。

## 3. ezdxfで形状を抽出

- モデル空間の LINE / LWPOLYLINE / POLYLINE / ARC / CIRCLE / SPLINE / ELLIPSE を対象にし、曲線は指定誤差で折れ線近似する。
- INSERT内の形状も展開する。外部参照の未解決や複雑なブロックはCAD側で確認する。
- 寸法・ハッチ・TEXT / MTEXT・リーダー・注記を除外。対象外タイプとマッピング外レイヤーは件数をレポートに残す。
- 取り込むのは明示されたレイヤーのみ。座標は (x - originMm.x, y - originMm.y) に統一してmmで格納する。
- DXFから意味を推測しない。窓を通路にしたり、空白を通行可能としたり、描画線を実走行ラインと無断で確定しない。

生成JSONは geometry（カテゴリ別の図形）と extractionReport（抽出・除外・未抽出）を持つ。抽出図形には匿名の連番IDを振り、CAD由来の実ファイル名を埋め込まない。

## 4. 部屋・エリア・扉・シャッターの接続をJSONへ

**図形からトポロジーを自動捏造しない。** 監修済みの入力設定（ローカル）に area / gate / node / edge を登録し、以下を検証・出力する。

| フィールド | 用途 |
| --- | --- |
| areas[] | パレタイズエリア、製品倉庫などの論理エリア（合成例はAREA-A/B） |
| gates[] | 扉／シャッターID、接続する2エリア、確認状態 |
| nodes[] | 接続・荷役・交差点などのノード、エリア、DXF座標、確認状態 |
| edges[] | from/to、ゲートID、通行可否、方向、車線数、同時すれ違い、確認状態 |
| routableEdgeIds[] | **通行可能＋方向確定＋状態confirmed**かつ参照ゲート確定のエッジのみ |

エリアが異なるノードをつなぐときは、対応するgateIdの指定を必須とする。シャッター開閉や実際の通行許可の動的条件は、グラフ／イベントエンジンに保持し、静的な通路図だけで通過させない。

**反映すべき既存の確認済み条件：** 倉庫東側から出入し西側SHをAGFが使用しない。パレタイズエリアは西側進入・東側退出。走行通路1・2は別々の双方向1車線で、2本の組合せを双方向2車線扱い。製品倉庫の幹線・個別保管列の条件は[通行仕様](specs/09-traffic.md)を正とする。未確定の旋回位置・停止点・個別の通過形態はprovisional/unresolvedで保持する。

## 5. 必要な場合だけグリッド地図を生成

オプションでJSONグリッドを出力する。**walkableの閉ポリゴンが明示されていなければ拒否**し、余白を「通行可能」にしない。設定には以下を明記する。

- cellMm：1セルの寸法
- agfRadiusMm：シミュレーション上のAGF占有半径（確定した値を入力）
- wallHalfWidthMm：線で描かれた壁の半幅

grid.cellsは 1=幾何的に通行候補、0=障害物／領域外。出力は **geometric_only** とし、動的シャッター、通行方向、複数車線、AGF間の干渉・予約、荷役占有を含まない。A*等で利用する場合も**グラフの通行条件と組み合わせる**。許可条件・車体寸法が未確定のまま実機安全判定には使わない。

## 6. ローカルでの実行例

Python 3.11以降を用意する。

~~~bash
python -m pip install -r requirements-map.txt

# DXF本体も、実図用のレイヤー対応表・トポロジー設定もprivate/に保存
python tools/dxf_to_map.py \
  --dxf private/input.dxf \
  --config private/map-config.json \
  --topology private/topology.json \
  --out private/generated/map.json

# 明示された歩行／走行可能ポリゴンがある場合のみオプション実行
python tools/dxf_to_map.py \
  --dxf private/input.dxf \
  --config private/map-config.json \
  --topology private/topology.json \
  --out private/generated/map.json \
  --grid-config private/grid-config.json \
  --grid-out private/generated/grid.json
~~~

コマンドのprivate/以下は説明用のパスで、実際のソース名を示さない。実出力をGitへcommitしない。エンジンとUIは schemaVersion / coordinateSystem / geometry / graph を読み取る実装へ接続する（現時点のシミュレーター本体との統合は未実装）。

## 7. 検証・受入条件

- 単位未設定やmm以外のDXF、原点未設定を拒否する。
- 形状を抽出しても、注記・寸法・ハッチはJSONに残さない。
- エリアをまたぐ接続は明示的なgateがないとエラー。
- 未確定・禁止エッジはroutableEdgeIdsへ入れない。
- グリッドは明示されたwalkableがないと生成しない。
- 合成DXFでPythonの自動テストを行う。本物のレイアウトの「完成」はDXFの現物、レイヤー設定、トポロジー確認がそろって初めて判断する。
