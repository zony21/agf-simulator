# 搬送エリア全体図：DXF → JSON 取込仕様 v0.2

関連：[全体マップ仕様書](specs/08-map.md)／[AGF通行・車線仕様書](specs/09-traffic.md)

この文書は**DXFを用いる場合の変換パイプラインとデータ契約**であり、現場図面の変換完了報告ではない。DXFがなくても[確定済み関係から作った抽象論理マップ](logical-map.md)は別途利用可能。公開リポジトリに元図・元のファイル名・実座標・識別可能な設備形状を保存しない。実データのDXF、設定、生成JSONはローカルの private/ 以下等で管理し、レビュー・公開承認がない限りGitへ追加しない。

## 0. 運用状況

- mm確定DXF向け変換プログラム：[tools/dxf_to_map.py](../tools/dxf_to_map.py)
- 単位未設定DXFの非公開点検・抽出：[tools/inspect_dxf_private.py](../tools/inspect_dxf_private.py)
- 依存関係： [requirements-map.txt](../requirements-map.txt)
- 合成テスト：[tests/test_dxf_to_map.py](../tests/test_dxf_to_map.py)・[tests/test_dxf_private_inspect.py](../tests/test_dxf_private_inspect.py)
- Gitに含む設定は**架空の合成サンプルのみ**。元のCAD図形・実座標・元レイヤー名・生成した私有JSONは公開GitHubに保存しない。
- DXFが提供されたため、非公開領域でヘッダーとレイヤーを検査し、選択した図形を私有JSONへ抽出した。**単位・原点の検証が終わっていないため、mm確定の実レイアウトと実走行距離への変換は保留**している。

## 非公開のmm仮定・図形プレビュー（実走行不可）

提供図のヘッダーが \`$INSUNITS=0\` の場合でも、利用者から「mmのはず」との暫定情報があるため、**表示専用に限り**明示オプション \`--assume-mm\` で1 CAD単位=1 mmとして描画できる。これはCAD原点・既知寸法との照合による実寸検証ではなく、実走行グラフ・ETAへの昇格許可ではない。ヘッダーに他単位が明記されている図面は同オプションでも拒否する。

[tools/private_cad_preview.py](../tools/private_cad_preview.py) は、非公開設定に完全一致で指定したレイヤーの図形だけを、ブラウザで読み込めるSVGに描画する。図面レイヤー名や元図名称は公開リポジトリに保存しない。TEXT・寸法は出力しない。対応できないINSERTや図形は報告し、**完全抽出と見なさない**。出力SVG/レポートは必ずGit管理外のprivate/等に保持する。

~~~bash
python tools/private_cad_preview.py \
  --dxf private/input.dxf \
  --layer-config private/preview-layers.json \
  --out-svg private/generated/preview.svg \
  --out-report private/generated/preview-report.json \
  --assume-mm
~~~

設定形式（以下のレイヤー名は架空の合成例）：

~~~json
{"categories":{"architecture":["SYN-BUILDING"],"equipment":["SYN-MACHINES"]}}
~~~

出力レポートには \`unitEvidence=user-provisional\`、\`metricScaleVerified=false\`、\`referenceOriginVerified=false\`、\`displayOnly=true\`、\`routable=false\` を明示する。SVGはブラウザ画面の「非公開CADプレビュー」から**端末内で読み込む**。読み込み時、模式図のAGF仮位置を非表示にし、正確な位置合わせ済みとは表示しない。PNGも図形プレビューとして読み込めるが、SVGほど拡大時の解像度は保てない。

これは上記 \`dxf_to_map.py\` の**単位と原点を明示して走行トポロジーを渡す工程とは独立**である。次の物理経路検証には、既知長さの寸法、基準原点、未解決INSERT、設備・荷役停止点、シャッター通行線とルート承認が必要。

## 1. DXFへ書き出し：単位・原点を統一

1. 使用するCADで対象階のモデル空間を確認する。外部参照があれば必要なものをバインドし、書き出しの欠落がないことを確認する。
2. **DXF**として保存する。DWGのファイル名や元図はGitへ入れない。
3. 図面単位を**mm**にし、DXFヘッダー $INSUNITS = 4 を確認する。
4. 全レイヤーで統一した原点（元の図面座標での x,y）を明記し、入力設定の originMm に登録する。実図面から勝手に原点を推定しない。
5. 回転・縮尺・各参照図の位置合わせをCAD側で確認する。X,Yの2D投影の扱いを記録し、現場との距離の一致を確認する。

**mm確定の変換は、DXFヘッダーがmm以外または原点未指定なら拒否**する。一方、非公開の事前点検ツールは単位未設定でも読み込み、`unverified`として区別する。単位コードを勝手に4へ書き換えたり、CAD座標をmmと断定しない。DXFから走行可能領域や安全な旋回・すれ違いを自動確定しない。

## 1.1 単位・原点が未確定の場合の私有抽出

元のCAD座標を維持した**私有CAD-native形式**で、図形確認を先行できる。実寸法を保証しないため、単位・原点・距離を未検証と明示し、経路探索に無条件に流用しない。元のレイヤーと分類は非公開の設定ファイルで管理し、寸法・ハッチ・注記は抽出対象外とする。INSERTの参照形状はこの私有抽出では未展開であり、元図照合が必要。

~~~bash
python tools/inspect_dxf_private.py \
  --dxf private/input.dxf \
  --out-report private/report.json

python tools/inspect_dxf_private.py \
  --dxf private/input.dxf \
  --layer-config private/layers.json \
  --out-report private/report.json \
  --out-geometry private/geometry.json.gz
~~~

実CAD派生の出力はprivate/等の非公開場所限定。ツールは公開リポジトリ内の追跡対象パスへの書き出しを拒否する。単位・原点・実際の通行線・設備別停止点を確認できた場合に限り、mm確定変換と物理経路へ進める。

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

grid.cellsは 1=幾何的に通行候補、0=障害物／領域外。**製品パレットのロケーションは固定障害物として自動的には塗りつぶさない**。在荷・置きタスク・個別ロケーションの進入制約は別の動的状態で反映する。出力は **geometric_only** とし、動的シャッター、通行方向、複数車線、AGF間の干渉・予約、荷役占有を含まない。A*等で利用する場合も**グラフの通行条件と組み合わせる**。許可条件・車体寸法が未確定のまま実機安全判定には使わない。

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
- 合成DXFでPythonの自動テストを行う。単位未設定をmmと誤認しないこと、注記除外、実CADの公開パスへの出力拒否を確認する。CAD準拠レイアウトの完成は単位・原点・レイヤー・INSERTの展開・トポロジーを検証した後に判断する。
