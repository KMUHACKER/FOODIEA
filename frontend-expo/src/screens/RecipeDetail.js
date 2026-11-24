import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image, ActivityIndicator } from 'react-native';

import { apiOrigin, recipeImageUrl } from '../api';

export default function RecipeDetail({ route }) {
    const { id } = route.params; // 전달받은 레시피 ID
    const [recipe, setRecipe] = useState(null);
    const [loading, setLoading] = useState(true);


    useEffect(() => {
        const fetchRecipeDetail = async () => {
            try {
                const origin = apiOrigin('recipes');
                const response = await fetch(`${origin}/recipe/${encodeURIComponent(id)}`);
                if (!response.ok) throw new Error('Recipe detail request failed');
                const { recipe } = await response.json();
                setRecipe({
                    ...recipe,
                    mainImage: recipeImageUrl(recipe.mainImage, origin),
                    steps: recipe.steps.map(step => ({ ...step, image: recipeImageUrl(step.image, origin) })),
                });
            } catch (error) {
                console.error('Failed to fetch recipe detail:', error.message);
                setRecipe(null); // 오류 발생 시 null 설정
            } finally {
                setLoading(false);
            }
        };

        fetchRecipeDetail();
    }, [id]);

    if (loading) {
        return (
            <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color="#ff5a5f" />
            </View>
        );
    }

    if (!recipe) {
        return (
            <View style={styles.errorContainer}>
                <Text style={styles.errorText}>
                    레시피를 불러오는 중 오류가 발생했습니다.
                </Text>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Image source={{ uri: recipe.mainImage }} style={styles.mainImage} />
            <Text style={styles.title}>{recipe.name}</Text>
            <Text style={styles.sectionTitle}>재료</Text>
            <Text style={styles.text}>{recipe.ingredients}</Text>
            <Text style={styles.sectionTitle}>조리 과정</Text>
            {recipe.steps.map((step, index) => (
                <View key={index} style={styles.step}>
                    {step.image && <Image source={{ uri: step.image }} style={styles.stepImage} />}
                    <Text style={styles.stepText}>{step.description}</Text>
                </View>
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 10,
        backgroundColor: '#fff',
    },
    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    errorText: {
        fontSize: 18,
        color: '#999',
    },
    mainImage: {
        width: '100%',
        height: 200,
        borderRadius: 10,
        marginBottom: 10,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 20,
        marginBottom: 10,
    },
    text: {
        fontSize: 16,
        color: '#666',
    },
    step: {
        marginBottom: 20,
        padding: 10,
        backgroundColor: '#f9f9f9',
        borderRadius: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    stepImage: {
        width: '100%',
        height: 150,
        borderRadius: 10,
        marginBottom: 10,
    },
    stepText: {
        fontSize: 16,
        color: '#666',
        lineHeight: 24,
    },
});
