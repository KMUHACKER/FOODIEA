import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { apiOrigin } from '../api';

export default function NoticeBoard({ route }) {
    const navigation = useNavigation();
    const [recipes, setRecipes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [failed, setFailed] = useState(false);
    const [backendUrl, setBackendUrl] = useState(null);
    const { ingredients = [] } = route.params ?? {};
    const ingredientQuery = ingredients.join(',');
    const paging = useRef(null);

    async function fetchRecipes() {
        const state = paging.current;
        if (!state || state.pending || state.done) return;
        state.pending = true;
        setLoading(true);
        setFailed(false);
        try {
            const origin = apiOrigin('recipes');
            const response = await fetch(
                `${origin}/search?ingredients=${encodeURIComponent(ingredientQuery)}&page=${state.page}&limit=10`,
                { signal: state.controller.signal },
            );
            if (!response.ok) throw new Error('Recipe search failed');
            const { recipes: batch } = await response.json();
            if (state.controller.signal.aborted) return;

            state.page += 1;
            state.done = batch.length < 10;
            setBackendUrl(origin);
            setRecipes(previous => [...previous, ...batch]);
            setHasMore(!state.done);
        } catch {
            if (!state.controller.signal.aborted) setFailed(true);
        } finally {
            state.pending = false;
            if (!state.controller.signal.aborted) setLoading(false);
        }
    }

    useEffect(() => {
        const controller = new AbortController();
        paging.current = { controller, page: 1, pending: false, done: !ingredientQuery };
        setRecipes([]);
        setHasMore(Boolean(ingredientQuery));
        setFailed(false);
        setLoading(false);
        if (ingredientQuery) fetchRecipes();
        return () => controller.abort();
    }, [ingredientQuery]);

    const noResults = !hasMore && recipes.length === 0;
    const renderRecipe = ({ item }) => (
        <View style={styles.card}>
            <Image
                source={{ uri: `${backendUrl}/images/${item.ID}/${item.ID}_main.jpg` }}
                style={styles.recipeImage}
            />
            <Text style={styles.recipeTitle}>{item.Name || '이름 없음'}</Text>
            <TouchableOpacity
                onPress={() => navigation.navigate('RecipeDetail', { id: item.ID })}
            >
                <Text style={styles.recipeLink}>상세 보기</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <View style={styles.container}>
            {noResults ? (
                <View style={styles.noResultsContainer}>
                    <Text style={styles.noResultsText}>검색된 레시피가 없습니다.</Text>
                </View>
            ) : (
                <FlatList
                    data={recipes}
                    renderItem={renderRecipe}
                    keyExtractor={(item, index) => item.ID ? `${item.ID}_${index}` : `${index}`} // 이 부분을 수정
                    numColumns={2} // 2열 그리드
                    contentContainerStyle={styles.contentContainer}
                    onEndReached={() => { if (!failed) fetchRecipes(); }} // 스크롤 끝에 도달 시 데이터 추가 로드
                    onEndReachedThreshold={0.5} // 트리거 임계값
                    ListFooterComponent={
                        loading ? <ActivityIndicator size="large" color="#007BFF" /> :
                            failed ? <Text onPress={fetchRecipes}>검색에 실패했습니다. 다시 시도</Text> : null
                    }
                />
            )}
            {/* "더 이상 데이터가 없습니다." 문구 */}
            {!hasMore && recipes.length > 0 && (
                <View style={styles.noMoreDataContainer}>
                    <Text style={styles.noMoreDataText}>더 이상 데이터가 없습니다.</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    contentContainer: {
        padding: 10,
    },
    card: {
        flex: 1,
        margin: 5,
        backgroundColor: '#f9f9f9',
        borderRadius: 10,
        alignItems: 'center',
        padding: 10,
    },
    recipeImage: {
        width: '100%',
        height: 120,
        borderRadius: 10,
    },
    recipeTitle: {
        fontWeight: 'bold',
        fontSize: 14,
        marginVertical: 5,
        textAlign: 'center',
    },
    recipeLink: {
        color: '#007BFF',
        textAlign: 'center',
    },
    noMoreDataContainer: {
        alignItems: 'center',
        marginVertical: 10,
    },
    noMoreDataText: {
        color: '#888',
    },
    noResultsContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    noResultsText: {
        fontSize: 18,
        color: '#888',
    },
});